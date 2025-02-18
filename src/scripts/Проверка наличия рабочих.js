/**
 * Функция для обработки требований к рабочей силе в шаблонах построек, включая требования по профессиям
 * и автоматическое добавление отсутствующих ключей с значениями по умолчанию.
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист (не используется, но включен для совместимости)
 * @param {Spreadsheet} spreadsheet - Активная таблица (может быть использована для логирования)
 * @returns {Array<string>} messages - Массив сообщений об обработке
 */
function processRequiredWorkers(data, sheet, spreadsheet) {
  const messages = [];

  try {
    const templatesData = data['Постройки_Шаблоны'];
    const populationData = data['Население_ОсновнаяИнформация'];
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    const variablesData = data['Переменные'];

    // Проверка наличия необходимых данных
    if (!templatesData || templatesData.length === 0) {
      messages.push('[Ошибка][processRequiredWorkers] Именной диапазон "Постройки_Шаблоны" пуст или не содержит данных.');
      return messages;
    }

    if (!populationData || populationData.length === 0) {
      messages.push('[Ошибка][processRequiredWorkers] Именной диапазон "Население_ОсновнаяИнформация" пуст или не содержит данных.');
      return messages;
    }

    if (!provincesData || provincesData.length === 0) {
      messages.push('[Ошибка][processRequiredWorkers] Именной диапазон "Провинции_ОсновнаяИнформация" пуст или не содержит данных.');
      return messages;
    }

    if (!variablesData || variablesData.length === 0) {
      messages.push('[Ошибка][processRequiredWorkers] Именной диапазон "Переменные" пуст или не содержит данных.');
      return messages;
    }

    // 1. Получение state_name из "Переменные"
    let stateName;
    try {
      const targetIdentifier = 'Основные данные государства';
      
      // Ищем строку с нужным идентификатором
      const targetRow = data['Переменные'].find(row => row[0] === targetIdentifier);
      
      if (targetRow && targetRow[1]) {
        // Извлекаем JSON из второго столбца
        const jsonMatch = targetRow[1].match(/\{.*\}/);
        if (jsonMatch) {
          const variablesJson = JSON.parse(jsonMatch[0]);
          stateName = variablesJson.state_name;
          
          if (!stateName) {
            messages.push(`[Ошибка][processRequiredWorkers] Ключ "state_name" не найден в Переменные.`);
            return messages;
          }
        } else {
          throw new Error('Не удалось извлечь JSON из содержимого Переменные.');
        }
      } else {
        throw new Error(`Идентификатор "${targetIdentifier}" не найден в Переменные.`);
      }
    } catch (e) {
      messages.push(`[Ошибка][processRequiredWorkers] Ошибка при парсинге JSON из Переменные: ${e.message}`);
      return messages;
    }

    // Парсинг списка провинций
    const provinces = provincesData
      .map((row, index) => {
        const cell = row[0];
        if (cell) {
          try {
            const province = JSON.parse(cell);
            if (province.id && province.owner) {
              return province;
            } else {
              messages.push(`[Ошибка][processRequiredWorkers] Провинция в строке ${index + 1} не содержит ключи "id" или "owner".`);
              return null;
            }
          } catch (e) {
            messages.push(`[Ошибка][processRequiredWorkers] Парсинг JSON провинции в строке ${index + 1}: ${e.message}`);
            return null;
          }
        }
        return null;
      })
      .filter(province => province !== null);

    // Создание карты провинций по ID
    const provinceMap = {};
    provinces.forEach(province => {
      provinceMap[province.id] = province;
    });

    // ----------------------------------------------------------------------------
    // БЛОК, где мы адаптируемся под новую структуру хранения населения
    // ----------------------------------------------------------------------------
    // Вместо старых массивов popGroup теперь есть единый объект с полем "province_id"
    // и значениями total_workers, employed_workers, unemployed_workers на верхнем уровне
    // ----------------------------------------------------------------------------

    // Словарь для суммирования свободных рабочих по провинциям
    const unemployedWorkersMap = {}; // { province_id: total_unemployed_workers }

    populationData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (cell) {
        try {
          const populationInfo = JSON.parse(cell);

          // Проверяем есть ли province_id
          const provinceId = populationInfo.province_id;
          if (!provinceId) {
            messages.push(`[Предупреждение][processRequiredWorkers] В строке ${rowIndex + 1} отсутствует "province_id". Пропускаем...`);
            return;
          }

          // Извлекаем число безработных из верхнего уровня
          const unemployed = (
            typeof populationInfo.unemployed_workers === 'number' 
              ? populationInfo.unemployed_workers 
              : 0
          );

          // Суммируем для случая, если вдруг на одной провинции несколько строчек
          if (!unemployedWorkersMap[provinceId]) {
            unemployedWorkersMap[provinceId] = 0;
          }
          unemployedWorkersMap[provinceId] += unemployed;

        } catch (e) {
          messages.push(`[Ошибка][processRequiredWorkers] Парсинг JSON населения в строке ${rowIndex + 1}: ${e.message}`);
        }
      }
    });

    // Разделение провинций на "наши" и "чужие" по владельцу
    const ourProvinces = provinces
      .filter(province => province.owner === stateName)
      .map(p => p.id);
    const otherProvinces = provinces
      .filter(province => province.owner !== stateName)
      .map(p => p.id);

    // Обрабатываем каждый шаблон построек
    const updatedTemplates = templatesData.map((row, rowIndex) => {
      const cell = row[0];
      if (cell) {
        try {
          const template = JSON.parse(cell);

          // Автоматическое добавление отсутствующих ключей
          // (required_workers_professions, allowed_building_state, allowed_building_others и т.д.)

          // 1. required_workers_professions
          if (!template.hasOwnProperty('required_workers_professions')) {
            template.required_workers_professions = [];
            messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" добавлен ключ "required_workers_professions" (пустой массив).`);
          } else if (!Array.isArray(template.required_workers_professions)) {
            messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" ключ "required_workers_professions" не является массивом. Сбрасываем в [].`);
            template.required_workers_professions = [];
          }

          // 2. allowed_building_state
          if (!template.hasOwnProperty('allowed_building_state')) {
            template.allowed_building_state = [];
            messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" добавлен ключ "allowed_building_state" (пустой массив).`);
          } else if (!Array.isArray(template.allowed_building_state)) {
            messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" ключ "allowed_building_state" не является массивом. Сбрасываем в [].`);
            template.allowed_building_state = [];
          }

          // 3. allowed_building_others
          if (!template.hasOwnProperty('allowed_building_others')) {
            template.allowed_building_others = [];
            messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" добавлен ключ "allowed_building_others" (пустой массив).`);
          } else if (!Array.isArray(template.allowed_building_others)) {
            messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" ключ "allowed_building_others" не является массивом. Сбрасываем в [].`);
            template.allowed_building_others = [];
          }

          // Если нет required_workers и нет required_workers_professions, то добавляем required_workers: 0
          if (!template.hasOwnProperty('required_workers') && template.required_workers_professions.length === 0) {
            template.required_workers = 0;
            messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" добавлен ключ "required_workers": 0.`);
          }

          // Если есть список профессий – пересчитываем required_workers как сумму по профессиям
          if (Array.isArray(template.required_workers_professions)) {
            const totalRequiredWorkers = template.required_workers_professions.reduce((sum, professionObj, profIndex) => {
              if (typeof professionObj.quantity === 'number' && professionObj.quantity >= 0) {
                return sum + professionObj.quantity;
              } else {
                messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" у профессии #${profIndex + 1} некорректное "quantity": ${professionObj.quantity}. Считаем за 0.`);
                return sum;
              }
            }, 0);

            template.required_workers = totalRequiredWorkers;
          } else {
            // Если professions не массив, а required_workers нет – подстрахуемся
            if (!template.hasOwnProperty('required_workers')) {
              template.required_workers = 0;
              messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" "required_workers" установлено в 0 (нет массива "required_workers_professions").`);
            }
          }

          // Проверим корректность required_workers
          let requiredWorkers = template.required_workers;
          if (typeof requiredWorkers !== 'number' || requiredWorkers < 0) {
            messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" значение "required_workers" некорректно: ${requiredWorkers}. Установлено 0.`);
            template.required_workers = 0;
            requiredWorkers = 0;
          }

          // Функция для фильтрации провинций по достатку безработных
          const filterProvinces = (provinceList, type) => {
            if (!Array.isArray(provinceList)) {
              messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" ключ "${type}" не является массивом.`);
              return [];
            }

            // Оставляем только те провинции, где свободных рабочих >= requiredWorkers
            const eligible = provinceList.filter(id => {
              const availableWorkers = unemployedWorkersMap[id] || 0;
              return availableWorkers >= requiredWorkers;
            });

            // Определяем, из каких провинций мы "убрали" возможность строить
            const removed = provinceList.filter(id => !eligible.includes(id));
            if (removed.length > 0) {
              messages.push(
                `[Постройки][Требования к рабочим] Постройка "${template.name || 'Без названия'}" ` +
                `${type}: ${removed.join(', ')} больше не может быть построена (недостаток свободных рабочих).`
              );
            }

            return eligible;
          };

          // Обновляем списки "allowed_building_state" и "allowed_building_others"
          if (template.hasOwnProperty('allowed_building_state')) {
            // Берём только те провинции, которые ещё числятся в template.allowed_building_state
            const filteredOurProvinces = ourProvinces.filter(id => template.allowed_building_state.includes(id));
            template.allowed_building_state = filterProvinces(filteredOurProvinces, 'в наших провинциях');
          }

          if (template.hasOwnProperty('allowed_building_others')) {
            // Берём только те провинции, которые ещё числятся в template.allowed_building_others
            const filteredOtherProvinces = otherProvinces.filter(id => template.allowed_building_others.includes(id));
            template.allowed_building_others = filterProvinces(filteredOtherProvinces, 'в провинциях других государств');
          }

          // Возвращаем обновлённый шаблон в ячейку (как JSON-строку)
          return [JSON.stringify(template)];

        } catch (e) {
          messages.push(`[Ошибка][processRequiredWorkers] Парсинг JSON шаблона в строке ${rowIndex + 1}: ${e.message}`);
          // Возвращаем исходную строку без изменений
          return row;
        }
      }
      // Если пустая ячейка, просто не трогаем
      return row;
    });

    // Записываем обновлённые данные шаблонов обратно в data
    data['Постройки_Шаблоны'] = updatedTemplates;

    return messages;

  } catch (error) {
    messages.push(`[Ошибка][processRequiredWorkers] processRequiredWorkers: ${error.message}`);
    return messages;
  }
}
