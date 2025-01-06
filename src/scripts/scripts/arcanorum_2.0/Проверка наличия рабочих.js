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
    const variablesData = data['Переменные_Основные'];

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
      messages.push('[Ошибка][processRequiredWorkers] Именной диапазон "Переменные_Основные" пуст или не содержит данных.');
      return messages;
    }

    // Получение названия текущего государства
    let stateName = '';
    try {
      const stateInfo = JSON.parse(variablesData[0][0]);
      if (stateInfo.state_name) {
        stateName = stateInfo.state_name;
      } else {
        messages.push('[Ошибка][processRequiredWorkers] В "Переменные_Основные" отсутствует ключ "state_name".');
        return messages;
      }
    } catch (e) {
      messages.push(`[Ошибка][processRequiredWorkers] Парсинг JSON в "Переменные_Основные": ${e.message}`);
      return messages;
    }

    // Парсинг провинций
    const provinces = provincesData
      .map((row, index) => {
        const cell = row[0];
        if (cell) {
          try {
            const province = JSON.parse(cell);
            if (province.id && province.owner) {
              return province;
            } else {
              messages.push(`[Ошибка][processRequiredWorkers] Провинция в строке ${index + 1} не содержит ключи "id" или "owner" с корректными типами.`);
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

    // Парсинг населения и суммирование свободных рабочих по провинциям
    const unemployedWorkersMap = {}; // { province_id: total_unemployed_workers }

    populationData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (cell) {
        try {
          const populationInfo = JSON.parse(cell);
          if (Array.isArray(populationInfo.pops)) {
            populationInfo.pops.forEach(popGroup => {
              const provinceId = popGroup.province_id;
              const unemployed = popGroup.employment && typeof popGroup.employment.unemployed_workers === 'number'
                ? popGroup.employment.unemployed_workers
                : 0;

              if (provinceId) {
                if (!unemployedWorkersMap[provinceId]) {
                  unemployedWorkersMap[provinceId] = 0;
                }
                unemployedWorkersMap[provinceId] += unemployed;
              } else {
                messages.push(`[Предупреждение][processRequiredWorkers] В строке ${rowIndex + 1} отсутствует "province_id" у группы населения.`);
              }
            });
          } else {
            messages.push(`[Ошибка][processRequiredWorkers] В строке ${rowIndex + 1} ключ "pops" не является массивом.`);
          }
        } catch (e) {
          messages.push(`[Ошибка][processRequiredWorkers] Парсинг JSON населения в строке ${rowIndex + 1}: ${e.message}`);
        }
      }
    });

    // Разделение провинций на наши и чужие
    const ourProvinces = provinces.filter(province => province.owner === stateName).map(p => p.id);
    const otherProvinces = provinces.filter(province => province.owner !== stateName).map(p => p.id);

    // Обработка каждого шаблона построек
    const updatedTemplates = templatesData.map((row, rowIndex) => {
      const cell = row[0];
      if (cell) {
        try {
          const template = JSON.parse(cell);

          // Автоматическое добавление отсутствующих ключей с значениями по умолчанию

          // Добавление required_workers_professions, если отсутствует
          if (!template.hasOwnProperty('required_workers_professions')) {
            template.required_workers_professions = [];
            messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" добавлен отсутствующий ключ "required_workers_professions" как пустой массив.`);
          } else if (!Array.isArray(template.required_workers_professions)) {
            messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" ключ "required_workers_professions" не является массивом. Устанавливается пустой массив.`);
            template.required_workers_professions = [];
          }

          // Добавление allowed_building_state, если отсутствует
          if (!template.hasOwnProperty('allowed_building_state')) {
            template.allowed_building_state = [];
            messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" добавлен отсутствующий ключ "allowed_building_state" как пустой массив.`);
          } else if (!Array.isArray(template.allowed_building_state)) {
            messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" ключ "allowed_building_state" не является массивом. Устанавливается пустой массив.`);
            template.allowed_building_state = [];
          }

          // Добавление allowed_building_others, если отсутствует
          if (!template.hasOwnProperty('allowed_building_others')) {
            template.allowed_building_others = [];
            messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" добавлен отсутствующий ключ "allowed_building_others" как пустой массив.`);
          } else if (!Array.isArray(template.allowed_building_others)) {
            messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" ключ "allowed_building_others" не является массивом. Устанавливается пустой массив.`);
            template.allowed_building_others = [];
          }

          // Добавление required_workers, если отсутствует и required_workers_professions тоже отсутствует
          if (!template.hasOwnProperty('required_workers') && template.required_workers_professions.length === 0) {
            template.required_workers = 0;
            messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" добавлен отсутствующий ключ "required_workers" со значением 0.`);
          }

          // Обработка required_workers_professions
          if (Array.isArray(template.required_workers_professions)) {
            const totalRequiredWorkers = template.required_workers_professions.reduce((sum, professionObj, profIndex) => {
              if (typeof professionObj.quantity === 'number' && professionObj.quantity >= 0) {
                return sum + professionObj.quantity;
              } else {
                messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" профессия #${profIndex + 1} имеет некорректное значение "quantity": ${professionObj.quantity}.`);
                return sum;
              }
            }, 0);

            // Запись суммы в required_workers
            template.required_workers = totalRequiredWorkers;
            // messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" суммарное количество "required_workers" установлено в ${totalRequiredWorkers} на основе "required_workers_professions".`);
          } else {
            // Если required_workers_professions не является массивом, но required_workers присутствует, ничего не делаем
            if (!template.hasOwnProperty('required_workers')) {
              template.required_workers = 0;
              messages.push(`[Информация][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" установлено "required_workers" в 0.`);
            }
          }

          let requiredWorkers = template.required_workers;

          if (typeof requiredWorkers !== 'number' || requiredWorkers < 0) {
            messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" значение "required_workers" некорректно: ${requiredWorkers}. Установлено значение 0.`);
            template.required_workers = 0;
            requiredWorkers = 0;
          }

          // Функция для фильтрации списка провинций
          const filterProvinces = (provinceList, type) => {
            if (Array.isArray(provinceList)) {
              const eligible = provinceList.filter(id => {
                const availableWorkers = unemployedWorkersMap[id] || 0;
                return availableWorkers >= requiredWorkers;
              });

              const removed = provinceList.filter(id => !eligible.includes(id));

              if (removed.length > 0) {
                messages.push(`[Постройки][Требования к рабочим] Постройка "${template.name || 'Без названия'}" ${type}: ${removed.join(', ')} больше не может быть построена из-за недостатка свободных рабочих в этих провинциях.`);
              }

              return eligible;
            }
            messages.push(`[Ошибка][processRequiredWorkers] В шаблоне "${template.name || 'Без названия'}" ключ "${type}" не является массивом.`);
            return [];
          };

          // Обновление списков allowed_building_state и allowed_building_others
          if (template.hasOwnProperty('allowed_building_state')) {
            // Фильтруем только те провинции, которые из allowed_building_state
            const filteredOurProvinces = ourProvinces.filter(id => template.allowed_building_state.includes(id));
            template.allowed_building_state = filterProvinces(filteredOurProvinces, 'в наших провинциях');
          }

          if (template.hasOwnProperty('allowed_building_others')) {
            // Фильтруем только те провинции, которые из allowed_building_others
            const filteredOtherProvinces = otherProvinces.filter(id => template.allowed_building_others.includes(id));
            template.allowed_building_others = filterProvinces(filteredOtherProvinces, 'в провинциях других государств');
          }

          // Возврат обновленного шаблона
          return [JSON.stringify(template)];
        } catch (e) {
          messages.push(`[Ошибка][processRequiredWorkers] Парсинг JSON шаблона в строке ${rowIndex + 1}: ${e.message}`);
          return row; // Возврат исходной строки без изменений
        }
      }
      return row; // Пустые ячейки остаются без изменений
    });

    // Обновление данных в объекте data
    data['Постройки_Шаблоны'] = updatedTemplates;

    return messages;

  } catch (error) {
    messages.push(`[Ошибка][processRequiredWorkers] processRequiredWorkers: ${error.message}`);
    return messages;
  }
}
