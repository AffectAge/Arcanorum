/**
 * Функция для обработки требований к пахотным землям в шаблонах построек
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист (не используется, но включен для совместимости)
 * @param {Spreadsheet} spreadsheet - Активная таблица (может быть использована для логирования)
 * @returns {Array<string>} messages - Массив сообщений об обработке
 */
function processArableLandRequirements(data, sheet, spreadsheet) {
  const messages = [];
  
  try {
    const templatesData = data['Постройки_Шаблоны'];
    const provincesData = data['Провинции_ОсновнаяИнформация'];

    if (!templatesData || templatesData.length === 0) {
      messages.push('[Ошибка] Именной диапазон "Постройки_Шаблоны" пуст или не содержит данных.');
      return messages;
    }

    if (!provincesData || provincesData.length === 0) {
      messages.push('[Ошибка] Именной диапазон "Провинции_ОсновнаяИнформация" пуст или не содержит данных.');
      return messages;
    }

    // Парсинг провинций для быстрого доступа
    const provinces = provincesData
      .map((row, index) => {
        const cell = row[0];
        if (cell) {
          try {
            const province = JSON.parse(cell);
            if (province.id && typeof province.free_arable_land === 'number') {
              return province;
            } else {
              messages.push(`[Предупреждение] Провинция в строке ${index + 1} не содержит ключи "id" или "free_arable_land" с корректными типами.`);
              return null;
            }
          } catch (e) {
            messages.push(`[Ошибка] Парсинг JSON провинции в строке ${index + 1}: ${e.message}`);
            return null;
          }
        }
        return null;
      })
      .filter(province => province !== null);

    // Создание карты провинций по ID для быстрого доступа
    const provinceMap = {};
    provinces.forEach(province => {
      provinceMap[province.id] = province;
    });

    // Обработка каждого шаблона построек
    const updatedTemplates = templatesData.map((row, rowIndex) => {
      const cell = row[0];
      if (cell) {
        try {
          const template = JSON.parse(cell);

          // Добавление ключа "required_arable_land", если его нет
          if (!template.hasOwnProperty('required_arable_land')) {
            template.required_arable_land = 0;
            messages.push(`[Информация] В шаблон "${template.name}" добавлен ключ "required_arable_land" со значением 0.`);
          }

          let requiredArableLand = template.required_arable_land;

          if (typeof requiredArableLand !== 'number' || requiredArableLand < 0) {
            messages.push(`[Предупреждение] В шаблоне "${template.name}" значение "required_arable_land" некорректно: ${requiredArableLand}. Установлено значение 0.`);
            template.required_arable_land = 0;
            requiredArableLand = 0;
          }

          // Фильтрация провинций, соответствующих требованию
          const eligibleProvinces = provinces
            .filter(province => province.free_arable_land >= requiredArableLand)
            .map(province => province.id);

          // Функция для фильтрации списка провинций
          const filterProvinces = (provinceList, type) => {
            if (Array.isArray(provinceList)) {
              const filtered = provinceList.filter(id => eligibleProvinces.includes(id));
              const removed = provinceList.filter(id => !eligibleProvinces.includes(id));

              if (removed.length > 0) {
                messages.push(`[Постройки] В шаблоне "${template.name}" из "${type}" удалены провинции из-за недостатка пахотных земель: ${removed.join(', ')}.`);
              }

              return filtered;
            }
            messages.push(`[Предупреждение] В шаблоне "${template.name}" ключ "${type}" не является массивом.`);
            return [];
          };

          // Обновление списков matching_provinces_state и matching_provinces_others
          if (template.hasOwnProperty('matching_provinces_state')) {
            template.matching_provinces_state = filterProvinces(template.matching_provinces_state, 'matching_provinces_state');
          } else {
            messages.push(`[Предупреждение] В шаблоне "${template.name}" отсутствует ключ "matching_provinces_state".`);
          }

          if (template.hasOwnProperty('matching_provinces_others')) {
            template.matching_provinces_others = filterProvinces(template.matching_provinces_others, 'matching_provinces_others');
          } else {
            messages.push(`[Предупреждение] В шаблоне "${template.name}" отсутствует ключ "matching_provinces_others".`);
          }

          // Возврат обновленного шаблона
          return [JSON.stringify(template)];
        } catch (e) {
          messages.push(`[Ошибка] Парсинг JSON шаблона в строке ${rowIndex + 1}: ${e.message}`);
          return row; // Возврат исходной строки без изменений
        }
      }
      return row; // Пустые ячейки остаются без изменений
    });

    // Обновление данных в объекте data
    data['Постройки_Шаблоны'] = updatedTemplates;

    return messages;
    
  } catch (error) {
    messages.push(`[Критическая ошибка] processArableLandRequirements: ${error.message}`);
    return messages;
  }
}
