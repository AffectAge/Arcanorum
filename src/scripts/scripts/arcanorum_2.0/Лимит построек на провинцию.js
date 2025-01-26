/**
 * Функция для обработки ограничений провинций на количество построек определенного типа
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист
 * @param {Spreadsheet} spreadsheet - Активная таблица
 * @returns {Array} newMessages - Массив новых сообщений для журнала
 */
function processProvinceLimits(data, sheet, spreadsheet) {
  let newMessages = [];
  
  try {
    // Получение state_name из Переменные_Основные
    const variablesData = data['Переменные_Основные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      newMessages.push(`[Ошибка][processProvinceLimits] Переменные_Основные пуст или не содержит данных.`);
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
          newMessages.push(`[Ошибка][processProvinceLimits] Ключ "state_name" не найден в Переменные_Основные.`);
          return newMessages;
        }
      } else {
        throw new Error('Не удалось извлечь JSON из содержимого Переменные_Основные.');
      }
    } catch (e) {
      newMessages.push(`[Ошибка][processProvinceLimits] Ошибка при парсинге JSON из Переменные_Основные: ${e.message}`);
      return newMessages;
    }
    
    // Получение списка провинций
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      newMessages.push(`[Ошибка][processProvinceLimits] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
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
            newMessages.push(`[Ошибка][processProvinceLimits] Провинция в строке ${index + 1} не содержит ключа "id".`);
          }
        } catch (e) {
          newMessages.push(`[Ошибка][processProvinceLimits] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });
    
    // Получение списка построек
    const buildingsData = data['Постройки_ОсновнаяИнформация'];
    if (!buildingsData || buildingsData.length === 0) {
      newMessages.push(`[Ошибка][processProvinceLimits] Постройки_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }
    
    // Подсчет построек в провинциях
    // Структура: { province_id: { building_name: count } }
    const buildingCounts = {};
    buildingsData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const parsedData = JSON.parse(cell);

          // **Изменение: Поддержка нескольких зданий в одной ячейке**
          const buildingsArray = Array.isArray(parsedData) ? parsedData : [parsedData];

          buildingsArray.forEach((building, bIndex) => {
            const buildingName = building.building_name;
            const provinceId = building.province_id;
            
            if (!buildingName || !provinceId) {
              newMessages.push(`[Ошибка][processProvinceLimits] Здание в строке ${index + 1}, элемент ${bIndex + 1} не содержит ключи "building_name" или "province_id".`);
              return;
            }
            
            if (!buildingCounts[provinceId]) {
              buildingCounts[provinceId] = {};
            }
            
            if (!buildingCounts[provinceId][buildingName]) {
              buildingCounts[provinceId][buildingName] = 0;
            }
            
            buildingCounts[provinceId][buildingName] += 1;
          });
          // **Конец изменения**
        } catch (e) {
          newMessages.push(`[Ошибка][processProvinceLimits] Ошибка при парсинге JSON из Постройки_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });
    
    // Получение списка шаблонов построек
    const templatesData = data['Постройки_Шаблоны'];
    if (!templatesData || templatesData.length === 0) {
      newMessages.push(`[Ошибка][processProvinceLimits] Постройки_Шаблоны пуст или не содержит данных.`);
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
            newMessages.push(`[Ошибка][processProvinceLimits] Шаблон в строке ${index + 1} не содержит ключа "name".`);
            return;
          }
          if (template.province_limit === undefined || template.province_limit === null) {
            newMessages.push(`[Ошибка][processProvinceLimits] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "province_limit".`);
            return;
          }
          templates.push({ data: template, row: index });
        } catch (e) {
          newMessages.push(`[Ошибка][processProvinceLimits] Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${index + 1}: ${e.message}`);
        }
      }
    });
    
    if (templates.length === 0) {
      newMessages.push(`[Ошибка][processProvinceLimits] Нет корректных шаблонов в Постройки_Шаблоны для обработки.`);
      return newMessages;
    }
    
    // Объект сопоставления ключей к понятным фразам
    const listKeyDescriptions = {
      'allowed_building_state': 'в наших провинциях',
      'allowed_building_others': 'в провинциях других государств'
    };
    
    // Обработка каждого шаблона
    templates.forEach(templateInfo => {
      const template = templateInfo.data;
      const templateName = template.name;
      const provinceLimit = template.province_limit;
      
      if (typeof provinceLimit !== 'number' || provinceLimit < 0) {
        newMessages.push(`[Ошибка][processProvinceLimits] Шаблон "${templateName}" имеет некорректное значение "province_limit": ${provinceLimit}.`);
        return;
      }
      
      // Проверка allowed_building_state и allowed_building_others
      ['allowed_building_state', 'allowed_building_others'].forEach(listKey => {
        if (Array.isArray(template[listKey])) {
          const originalList = template[listKey];
          const updatedList = [...originalList]; // Копия для изменения
          const removedProvinces = [];
          
          originalList.forEach(provinceId => {
            // Проверяем, существует ли провинция
            if (!provinceMap[provinceId]) {
              newMessages.push(`[Ошибка][processProvinceLimits] Провинция с ID "${provinceId}" из "${listKey}" шаблона "${templateName}" не найдена.`);
              return;
            }
            
            // Получаем количество зданий данного типа в провинции
            const count = buildingCounts[provinceId] && buildingCounts[provinceId][templateName] ? buildingCounts[provinceId][templateName] : 0;
            
            if (count >= provinceLimit) {
              // Удаляем провинцию из списка
              const index = updatedList.indexOf(provinceId);
              if (index !== -1) {
                updatedList.splice(index, 1);
                removedProvinces.push(provinceId);
              }
            }
          });
          
          if (removedProvinces.length > 0) {
            // Обновляем список в шаблоне
            template[listKey] = updatedList;
            
            // Получаем понятное описание списка
            const description = listKeyDescriptions[listKey] || listKey;
            
            // Получаем идентификаторы провинций для сообщения
            const provinceIds = removedProvinces.join(', ');
            
            // Генерируем сообщение
            newMessages.push(`[Критерии строительства][Лимит построек на провинцию] Постройка "${templateName}" больше не может быть построена ${description}: ${provinceIds} из-за достижения лимита данной постройки для одной провинции. Лимит: ${provinceLimit} на провинцию.`);
          }
        } else {
          newMessages.push(`[Ошибка][processProvinceLimits] Шаблон "${templateName}" не содержит массива "${listKey}".`);
        }
      });
      
      // Обновляем шаблон в data
      try {
        data['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
      } catch (e) {
        newMessages.push(`[Ошибка][processProvinceLimits] Ошибка при сериализации JSON для шаблона "${templateName}" в строке ${templateInfo.row + 1}: ${e.message}`);
      }
    });
    
  } catch (error) {
    newMessages.push(`[Ошибка][processProvinceLimits] processProvinceLimits: ${error.message}`);
  }
  
  return newMessages;
} 

/**
 * Функция для оценки соответствия состояния государства критериям
 * @param {Object} criteria - Критерии из state_required_buildings
 * @param {Object} buildingCounts - Объект с общим количеством построек по типам во всех провинциях государства
 * @returns {Boolean} - Возвращает true, если критерии выполнены, иначе false
 */
function evaluateStateCriteria(criteria, buildingCounts) {
  if (typeof criteria !== 'object' || criteria === null) return false;

  for (const operator in criteria) {
    if (!criteria.hasOwnProperty(operator)) continue;

    const value = criteria[operator];

    switch (operator) {
      case 'AND':
        if (!Array.isArray(value)) return false;
        return value.every(subCriteria => evaluateStateCriteria(subCriteria, buildingCounts));

      case 'OR':
        if (!Array.isArray(value)) return false;
        return value.some(subCriteria => evaluateStateCriteria(subCriteria, buildingCounts));

      case 'NOT':
        if (!Array.isArray(value)) return false;
        return !value.some(subCriteria => evaluateStateCriteria(subCriteria, buildingCounts));

      case 'MIN_COUNT':
        if (typeof value !== 'object') return false;
        for (const building in value) {
          if (!value.hasOwnProperty(building)) continue;
          const minCount = value[building];
          if ((buildingCounts[building] || 0) < minCount) return false;
        }
        return true;

      case 'MAX_COUNT':
        if (typeof value !== 'object') return false;
        for (const building in value) {
          if (!value.hasOwnProperty(building)) continue;
          const maxCount = value[building];
          if ((buildingCounts[building] || 0) > maxCount) return false;
        }
        return true;

      case 'XNOR':
        if (!Array.isArray(value) || value.length !== 2) return false;
        const [first, second] = value;
        const firstExists = (buildingCounts[first] || 0) > 0;
        const secondExists = (buildingCounts[second] || 0) > 0;
        return firstExists === secondExists;

      case 'IMPLIES':
        if (!Array.isArray(value) || value.length !== 2) return false;
        const [antecedent, consequent] = value;
        const antecedentExists = (buildingCounts[antecedent] || 0) > 0;
        const consequentExists = (buildingCounts[consequent] || 0) > 0;
        return !antecedentExists || consequentExists;

      default:
        // Если оператор неизвестен, возвращаем false
        return false;
    }
  }

  // Если критерий не содержит известных операторов
  return false;
}
