/**
 * Функция для обработки ограничений построек по государственному лимиту
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист
 * @param {Spreadsheet} spreadsheet - Активная таблица
 * @returns {Array} newMessages - Массив новых сообщений для журнала
 */
function processStateLimits(data, sheet, spreadsheet) {
  let newMessages = [];
  
  try {
    // 1. Получение state_name из Переменные_Основные
    const variablesData = data['Переменные_Основные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      newMessages.push(`[Ошибка][processStateLimits] Переменные_Основные пуст или не содержит данных.`);
      return newMessages;
    }
    
    let stateName;
    try {
      const rawData = variablesData[0][0];
      const jsonMatch = rawData.match(/\{.*\}/);
      if (jsonMatch) {
        const variablesJson = JSON.parse(jsonMatch[0]);
        stateName = variablesJson.state_name;
        if (!stateName) {
          newMessages.push(`[Ошибка][processStateLimits] Ключ "state_name" не найден в Переменные_Основные.`);
          return newMessages;
        }
      } else {
        throw new Error('Не удалось извлечь JSON из содержимого Переменные_Основные.');
      }
    } catch (e) {
      newMessages.push(`[Ошибка][processStateLimits] Ошибка при парсинге JSON из Переменные_Основные: ${e.message}`);
      return newMessages;
    }
    
    // 2. Получение списка провинций
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      newMessages.push(`[Ошибка][processStateLimits] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }
    
    // Парсинг провинций и группировка по владельцам
    const provinceMap = {}; // id -> province
    const stateProvinces = []; // Провинции нашего государства
    const otherProvinces = []; // Провинции других государств
    
    provincesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          let jsonString = cell;
          
          // Удаляем внешние кавычки, если они есть
          if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
            jsonString = jsonString.slice(1, -1);
          }
          
          // Заменяем двойные кавычки на одинарные
          jsonString = jsonString.replace(/""/g, '"');
          
          const province = JSON.parse(jsonString);
          if (province.id) {
            provinceMap[province.id] = province;
            if (province.owner === stateName) {
              stateProvinces.push(province.id);
            } else {
              otherProvinces.push(province.id);
            }
          } else {
            newMessages.push(`[Ошибка][processStateLimits] Провинция в строке ${index + 1} не содержит ключа "id".`);
          }
        } catch (e) {
          newMessages.push(`[Ошибка][processStateLimits] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });
    
    // 3. Получение списка построек
    const buildingsData = data['Постройки_ОсновнаяИнформация'];
    if (!buildingsData || buildingsData.length === 0) {
      newMessages.push(`[Ошибка][processStateLimits] Постройки_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }
    
    // Подсчет построек по типам и государствам
    // Структура: { state_owner: { building_name: count } }
    const buildingCountsByState = {}; // e.g., { "Империя Света": { "Кирпичный завод": 6 }, "Другая Империя": { ... } }
    
    buildingsData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const building = JSON.parse(cell);
          const buildingName = building.building_name;
          const provinceId = building.province_id;
          
          if (!buildingName || !provinceId) {
            newMessages.push(`[Ошибка][processStateLimits] Здание в строке ${index + 1} не содержит ключи "building_name" или "province_id".`);
            return;
          }
          
          const province = provinceMap[provinceId];
          if (!province) {
            newMessages.push(`[Ошибка][processStateLimits] Провинция с ID "${provinceId}" для здания в строке ${index + 1} не найдена.`);
            return;
          }
          
          const owner = province.owner;
          if (!buildingCountsByState[owner]) {
            buildingCountsByState[owner] = {};
          }
          
          if (!buildingCountsByState[owner][buildingName]) {
            buildingCountsByState[owner][buildingName] = 0;
          }
          
          buildingCountsByState[owner][buildingName] += 1;
        } catch (e) {
          newMessages.push(`[Ошибка][processStateLimits] Ошибка при парсинге JSON из Постройки_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });
    
    // 4. Получение списка шаблонов построек
    const templatesData = data['Постройки_Шаблоны'];
    if (!templatesData || templatesData.length === 0) {
      newMessages.push(`[Ошибка][processStateLimits] Постройки_Шаблоны пуст или не содержит данных.`);
      return newMessages;
    }
    
    // Парсинг шаблонов
    const templates = []; // { data: templateObject, row: rowIndex }
    templatesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const template = JSON.parse(cell);
          if (!template.name) {
            newMessages.push(`[Ошибка][processStateLimits] Шаблон в строке ${index + 1} не содержит ключа "name".`);
            return;
          }
          if (template.state_limit === undefined || template.state_limit === null) {
            newMessages.push(`[Ошибка][processStateLimits] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "state_limit".`);
            return;
          }
          templates.push({ data: template, row: index });
        } catch (e) {
          newMessages.push(`[Ошибка][processStateLimits] Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${index + 1}: ${e.message}`);
        }
      }
    });
    
    if (templates.length === 0) {
      newMessages.push(`[Ошибка][processStateLimits] Нет корректных шаблонов в Постройки_Шаблоны для обработки.`);
      return newMessages;
    }
    
    // 5. Объект сопоставления ключей к понятным фразам
    const listKeyDescriptions = {
      'allowed_building_state': 'в наших провинциях',
      'allowed_building_others': 'в провинциях других государств'
    };
    
    // 6. Обработка каждого шаблона
    templates.forEach(templateInfo => {
      const template = templateInfo.data;
      const templateName = template.name;
      const stateLimit = template.state_limit;
      
      if (typeof stateLimit !== 'number' || stateLimit < 0) {
        newMessages.push(`[Ошибка][processStateLimits] Шаблон "${templateName}" имеет некорректное значение "state_limit": ${stateLimit}.`);
        return;
      }
      
      // Получаем общее количество построек данного типа в каждом государстве
      // и проверяем против state_limit
      for (const owner in buildingCountsByState) {
        if (buildingCountsByState.hasOwnProperty(owner)) {
          const count = buildingCountsByState[owner][templateName] || 0;
          
          if (count >= stateLimit) {
            if (owner === stateName) {
              // Удаляем провинции нашего государства из allowed_building_state
              if (Array.isArray(template['allowed_building_state']) && template['allowed_building_state'].length > 0) {
                const originalList = template['allowed_building_state'];
                const removedProvinces = [...originalList]; // Копия для удаления
                
                // Очищаем список
                template['allowed_building_state'] = [];
                
                // Генерируем сообщение о удалении провинций
                const provinceNames = removedProvinces.map(id => {
                  const province = provinceMap[id];
                  return province ? province.name || province.id : id;
                }).join(', ');
                
                const description = listKeyDescriptions['allowed_building_state'] || 'allowed_building_state';
                
                newMessages.push(`[Критерии строительства][Лимит построек на государство] Постройка "${templateName}" больше не может быть построена ${description}: ${provinceNames} из-за достижения лимита данной постройки для одной провинции. Лимит: ${stateLimit} на государство.`);
              }
            } else {
              // Удаляем провинции других государств из allowed_building_others
              if (Array.isArray(template['allowed_building_others']) && template['allowed_building_others'].length > 0) {
                // Находим провинции, принадлежащие текущему owner
                const provincesToRemove = otherProvinces.filter(id => {
                  const province = provinceMap[id];
                  return province && province.owner === owner;
                });
                
                if (provincesToRemove.length > 0) {
                  const originalList = template['allowed_building_others'];
                  const updatedList = originalList.filter(id => !provincesToRemove.includes(id));
                  template['allowed_building_others'] = updatedList;
                  
                  const provinceNames = provincesToRemove.map(id => {
                    const province = provinceMap[id];
                    return province ? province.name || province.id : id;
                  }).join(', ');
                  
                  const description = listKeyDescriptions['allowed_building_others'] || 'allowed_building_others';
                  newMessages.push(`[Критерии строительства][Лимит построек на государство] Постройка "${templateName}" больше не может быть построена ${description}: ${provinceNames} из-за достижения лимита данной постройки для одного государства. Лимит: ${stateLimit} на государство.`);
                }
              }
            }
          }
        }
      }
      
      // Обновляем шаблон в data, если были изменения
      try {
        data['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
      } catch (e) {
        newMessages.push(`[Ошибка][processStateLimits] Ошибка при сериализации JSON для шаблона "${templateName}" в строке ${templateInfo.row + 1}: ${e.message}`);
      }
    });

  } catch (error) {
    newMessages.push(`[Ошибка][processStateLimits] processStateLimits: ${error.message}`);
  }
  
  return newMessages;
}
