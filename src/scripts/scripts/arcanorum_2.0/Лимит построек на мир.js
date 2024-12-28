/**
 * Функция для обработки ограничений построек по мировому лимиту
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист
 * @param {Spreadsheet} spreadsheet - Активная таблица
 * @returns {Array} newMessages - Массив новых сообщений для журнала
 */
function processWorldLimits(data, sheet, spreadsheet) {
  let newMessages = [];
  
  try {
    // 1. Получение state_name из Переменные_Основные
    const variablesData = data['Переменные_Основные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      newMessages.push(`[Ошибка] Переменные_Основные пуст или не содержит данных.`);
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
          newMessages.push(`[Ошибка] Ключ "state_name" не найден в Переменные_Основные.`);
          return newMessages;
        }
      } else {
        throw new Error('Не удалось извлечь JSON из содержимого Переменные_Основные.');
      }
    } catch (e) {
      newMessages.push(`[Ошибка] Ошибка при парсинге JSON из Переменные_Основные: ${e.message}`);
      return newMessages;
    }
    
    // 2. Получение списка провинций
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      newMessages.push(`[Ошибка] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }
    
    // Парсинг провинций
    const provinceMap = {}; // id -> province
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
          } else {
            newMessages.push(`[Предупреждение] Провинция в строке ${index + 1} не содержит ключа "id".`);
          }
        } catch (e) {
          newMessages.push(`[Ошибка] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });
    
    // 3. Получение списка построек
    const buildingsData = data['Постройки_ОсновнаяИнформация'];
    if (!buildingsData || buildingsData.length === 0) {
      newMessages.push(`[Ошибка] Постройки_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }
    
    // Подсчет построек в мире
    // Структура: { building_name: count }
    const buildingCounts = {};
    buildingsData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const building = JSON.parse(cell);
          const buildingName = building.building_name;
          const provinceId = building.province_id;
          
          if (!buildingName || !provinceId) {
            newMessages.push(`[Предупреждение] Здание в строке ${index + 1} не содержит ключи "building_name" или "province_id".`);
            return;
          }
          
          if (!buildingCounts[buildingName]) {
            buildingCounts[buildingName] = 0;
          }
          
          buildingCounts[buildingName] += 1;
        } catch (e) {
          newMessages.push(`[Ошибка] Ошибка при парсинге JSON из Постройки_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });
    
    // 4. Получение списка шаблонов построек
    const templatesData = data['Постройки_Шаблоны'];
    if (!templatesData || templatesData.length === 0) {
      newMessages.push(`[Ошибка] Постройки_Шаблоны пуст или не содержит данных.`);
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
            newMessages.push(`[Предупреждение] Шаблон в строке ${index + 1} не содержит ключа "name".`);
            return;
          }
          if (template.world_limit === undefined || template.world_limit === null) {
            newMessages.push(`[Предупреждение] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "world_limit".`);
            return;
          }
          templates.push({ data: template, row: index });
        } catch (e) {
          newMessages.push(`[Ошибка] Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${index + 1}: ${e.message}`);
        }
      }
    });
    
    if (templates.length === 0) {
      newMessages.push(`[Ошибка] Нет корректных шаблонов в Постройки_Шаблоны для обработки.`);
      return newMessages;
    }
    
    // 5. Обработка каждого шаблона
    templates.forEach(templateInfo => {
      const template = templateInfo.data;
      const templateName = template.name;
      const worldLimit = template.world_limit;
      
      if (typeof worldLimit !== 'number' || worldLimit < 0) {
        newMessages.push(`[Предупреждение] Шаблон "${templateName}" имеет некорректное значение "world_limit": ${worldLimit}.`);
        return;
      }
      
      // Получаем общее количество построек данного типа
      const totalBuildings = buildingCounts[templateName] || 0;
      
      if (totalBuildings >= worldLimit) {
        // Если лимит достигнут или превышен, удаляем все провинции из allowed_building_state и allowed_building_others
        ['allowed_building_state', 'allowed_building_others'].forEach(listKey => {
          if (Array.isArray(template[listKey]) && template[listKey].length > 0) {
            const removedProvinces = [...template[listKey]]; // Копируем текущий список
            
            // Очищаем список
            template[listKey] = [];
            
            // Генерируем сообщение о удалении провинций
            const provinceNames = removedProvinces.map(id => {
              const province = provinceMap[id];
              return province ? province.id : id;
            }).join(', ');
            
            newMessages.push(`[Постройки] В шаблоне "${templateName}" были удалены провинции из "${listKey}" из-за достижения мирового лимита построек (${worldLimit}): ${provinceNames}.`);
          }
        });
        
        // Обновляем шаблон в data
        data['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
      }
    });
    
  } catch (error) {
    newMessages.push(`[Ошибка] processWorldLimits: ${error.message}`);
  }
  
  return newMessages;
}
