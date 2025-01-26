/**
 * Массив объектов для проверки дополнительных условий
 */
const CHECK_FIELDS = [
  {
    buildingKey: 'required_landscapes', // Ключ из шаблона постройки
    provinceKey: 'landscapes',           // Соответствующий ключ из провинции
    evaluator: evaluateTextCriteria      // Функция для оценки условия
  },
  {
    buildingKey: 'required_planet',     
    provinceKey: 'planet',               
    evaluator: evaluateTextCriteria  
  },
  {
    buildingKey: 'required_culture',     
    provinceKey: 'province_culture',               
    evaluator: evaluateTextCriteria  
  },
  {
    buildingKey: 'required_religion',     
    provinceKey: 'province_religion',               
    evaluator: evaluateTextCriteria  
  },
  {
    buildingKey: 'required_climate',     
    provinceKey: 'province_climate',               
    evaluator: evaluateTextCriteria  
  },
  {
    buildingKey: 'required_radiation',
    provinceKey: 'province_radiation',
    evaluator: evaluateNumberCriteria
  },
  {
    buildingKey: 'required_pollution',
    provinceKey: 'province_pollution',
    evaluator: evaluateNumberCriteria
  },
  {
    buildingKey: 'required_stability',
    provinceKey: 'province_stability',
    evaluator: evaluateNumberCriteria
  }
  // Добавляйте новые условия по мере необходимости
];

/**
 * Массив ключей провинции, использующих evaluateTextCriteria
 */
const TEXT_CRITERIA_KEYS = CHECK_FIELDS
  .filter(field => field.evaluator === evaluateTextCriteria)
  .map(field => field.provinceKey);

/**
 * Функция для парсинга и обработки JSON данных согласно заданию
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист
 * @param {Spreadsheet} spreadsheet - Активная таблица
 * @returns {Object} - Объект с обновленными данными и новыми сообщениями
 */
function processBuildingsCriterias(data, sheet, spreadsheet) {
  const range1Data = data['Переменные_Основные'];
  const range2Data = data['Постройки_Шаблоны'];
  const range3Data = data['Провинции_ОсновнаяИнформация'];
  
  let newMessages = []; // Массив для хранения новых сообщений
  
  // Проверяем наличие данных в Переменные_Основные
  if (!range1Data || range1Data.length === 0 || !range1Data[0][0]) {
    const errorMsg = 'Переменные_Основные пуст или не содержит данных.';
    newMessages.push(`[Ошибка][processBuildingsCriterias] ${errorMsg}`);
    return newMessages; // Возвращаем без изменений
  }
  
  // Парсим JSON из первой ячейки Переменные_Основные и получаем state_name
  let stateName;
  try {
    const rawData = range1Data[0][0];
    
    // Извлечение JSON с помощью регулярного выражения
    const jsonMatch = rawData.match(/\{.*\}/);
    if (jsonMatch) {
      const range1Json = JSON.parse(jsonMatch[0]);
      stateName = range1Json.state_name;
      if (!stateName) {
        const errorMsg = 'Ключ "state_name" не найден в Переменные_Основные.';
        newMessages.push(`[Ошибка][processBuildingsCriterias] ${errorMsg}`);
        return newMessages;
      }
    } else {
      throw new Error('Не удалось извлечь JSON из содержимого Переменные_Основные.');
    }
  } catch (e) {
    const errorMsg = `Ошибка при парсинге JSON из Переменные_Основные: ${e.message}`;
    newMessages.push(`[Ошибка][processBuildingsCriterias] ${errorMsg}`);
    return newMessages;
  }
  
  // Парсим все JSON из Постройки_Шаблоны (шаблоны) без фильтрации по owner
  const templates = [];
  for (let i = 0; i < range2Data.length; i++) {
    const cell = range2Data[i][0];
    if (cell) {
      try {
        const template = JSON.parse(cell);
        templates.push({ 
          data: template, 
          row: i 
        });
      } catch (e) {
        const errorMsg = `Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${i+1}: ${e.message}`;
        newMessages.push(`[Ошибка][processBuildingsCriterias] ${errorMsg}`);
        // Игнорируем ошибку и продолжаем
      }
    }
  }
  
  if (templates.length === 0) {
    const errorMsg = 'Нет корректных шаблонов в Постройки_Шаблоны для обработки.';
    newMessages.push(`[Ошибка][processBuildingsCriterias] ${errorMsg}`);
    return newMessages;
  }
  
  // Парсим все JSON из Провинции_ОсновнаяИнформация и создаем карту id -> province
  const provinceMap = {};
  const allProvinces = [];
  for (let i = 0; i < range3Data.length; i++) {
    const cell = range3Data[i][0];
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
          // Автоматическое преобразование полей, использующих evaluateTextCriteria
          TEXT_CRITERIA_KEYS.forEach(key => {
            if (province[key]) {
              if (typeof province[key] === 'string') {
                province[key] = province[key].split(',').map(item => item.trim());
              }
              // Если поле уже массив, ничего не делаем
            }
          });
          
          // Преобразуем available_resources в массив, если это строка
          if (province.available_resources && typeof province.available_resources === 'string') {
            province.available_resources = province.available_resources.split(',').map(item => item.trim());
          }
          
          provinceMap[province.id] = province;
          allProvinces.push(province);
        }
      } catch (e) {
        const errorMsg = `Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${i+1}: ${e.message}`;
        newMessages.push(`[Ошибка][processBuildingsCriterias] ${errorMsg}`);
        // Игнорируем ошибку и продолжаем
      }
    }
  }
  
  // Обрабатываем каждый шаблон
  templates.forEach(templateInfo => {
    const template = templateInfo.data;
    
    // Инициализируем массивы для соответствующих провинций
    const matchingProvincesState = [];
    const matchingProvincesOthers = [];
    
    // Объект для отслеживания, какие критерии удовлетворяются хотя бы одной провинцией
    const criteriaSatisfied = {};
    CHECK_FIELDS.forEach(checkField => {
      criteriaSatisfied[checkField.buildingKey] = false;
    });
    
    // Проходим по каждой провинции и проверяем условия
    allProvinces.forEach(province => {
      let allConditionsMet = true;
      
      // Переменная для отслеживания, какие критерии не выполнены для этой провинции
      // Можно использовать, если нужно детализировать по провинциям
      
      // Проходим по каждому условию из CHECK_FIELDS
      CHECK_FIELDS.forEach(checkField => {
        const buildingCondition = template[checkField.buildingKey];
        const provinceValue = province[checkField.provinceKey];
        
        if (buildingCondition !== undefined && buildingCondition !== null) {
          // Если условие определено, оцениваем его
          const result = checkField.evaluator(buildingCondition, provinceValue);
          
          if (result) {
            // Если условие выполнено хотя бы одной провинцией, отмечаем его
            criteriaSatisfied[checkField.buildingKey] = true;
          } else {
            // Если условие не выполнено, продолжаем проверку
            // Можно добавить дополнительную логику, если требуется
          }
          
          if (!result) {
            allConditionsMet = false;
          }
        } else {
          // Если условие не определено, интерпретируем как отсутствие ограничений (true)
          // Не изменяем allConditionsMet
        }
      });
      
      // Если все условия выполнены, добавляем провинцию в соответствующий массив
      if (allConditionsMet) {
        if (province.owner === stateName) {
          matchingProvincesState.push(province.id);
        } else {
          matchingProvincesOthers.push(province.id);
        }
      }
    });
    
    // Добавляем результаты в шаблон
    template.matching_provinces_state = matchingProvincesState;
    template.matching_provinces_others = matchingProvincesOthers;

    // Добавляем новые ключи с той же информацией
    template.allowed_building_state = matchingProvincesState;
    template.allowed_building_others = matchingProvincesOthers;
    
    // Генерируем сообщения
    const constructionName = template.name ? `${template.name}` : `"Неизвестно"`;
    const constructionOwner = template.owner ? `${template.owner}` : `"Неизвестно"`;
    
    if (matchingProvincesState.length > 0 || matchingProvincesOthers.length > 0) {
      // Если есть подходящие провинции, генерируем сообщение о возможностях
      newMessages.push(`[Основные критерии построек] \n🏗️ Постройка 🏭${constructionName}, по основным критериям подходит для 🗾 провинций:`);
      
      if (matchingProvincesState.length > 0) {
        const provincesStateList = matchingProvincesState.join(', ');
        newMessages.push(`[Основные критерии построек] \n✅ Нашего государства: ${provincesStateList}.`);
      }
      
      if (matchingProvincesOthers.length > 0) {
        const provincesOthersList = matchingProvincesOthers.join(', ');
        newMessages.push(`[Основные критерии построек] \n✅ Других государств: ${provincesOthersList}.`);
      }
    }
    
    if (matchingProvincesState.length === 0 && matchingProvincesOthers.length === 0) {
      // Если ни одна провинция не подходит, генерируем соответствующее сообщение с точными причинами
      let reasons = [];
      
      CHECK_FIELDS.forEach(checkField => {
        const buildingCondition = template[checkField.buildingKey];
        if (buildingCondition !== undefined && buildingCondition !== null) {
          if (!criteriaSatisfied[checkField.buildingKey]) {
            // Добавляем название критерия в читаемом виде
            let reason = '';
            switch (checkField.buildingKey) {
              case 'required_landscapes':
                reason = 'Ландшафта';
                break;
              case 'required_planet':
                reason = 'Планеты';
                break;
              case 'required_culture':
                reason = 'Культуры';
                break;
              case 'required_religion':
                reason = 'Религии';
                break;
              case 'required_climate':
                reason = 'Климата';
                break;
              case 'required_radiation':
                reason = 'Радиации';
                break;
              case 'required_pollution':
                reason = 'Загрязнения';
                break;
              case 'required_stability':
                reason = 'Провинциальной стабильности';
                break;
              // Добавьте дополнительные случаи по мере необходимости
              default:
                reason = checkField.buildingKey.replace('required_', '').replace('_', ' ');
            }
            reasons.push(reason);
          }
        }
      });
      
      if (reasons.length === 0) {
        // Если не удалось определить причины, используем общий текст
        reasons.push('неизвестных причин');
      }
      
      // Формируем текст с разделением на запятые и "или"
      let reasonsText = '';
      if (reasons.length === 1) {
        reasonsText = reasons[0];
      } else if (reasons.length === 2) {
        reasonsText = `${reasons[0]} или ${reasons[1]}`;
      } else {
        reasonsText = reasons.slice(0, -1).join(', ') + ', или ' + reasons[reasons.length - 1];
      }
      
      newMessages.push(`[Постройки][Основные критерии] \nПостройка ${constructionName}, не подходит по основным критериям ни для одной провинции нашего государства или других государств, из-за неподходящего ${reasonsText}.`);
    }
    
    // Сериализуем обновленный шаблон обратно в JSON
    data['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
  });
  
  return newMessages;
}

/**
 * Универсальная функция для оценки логических условий относительно массива значений провинции
 * Поддерживаются операторы AND, OR, NOT, XOR, NAND, NOR
 * @param {Object} required - Объект с логическими операторами
 * @param {Array} provinceValues - Массив значений провинции (например, landscapes, planet и т.д.)
 * @returns {boolean} - Результат оценки выражения
 */
function evaluateTextCriteria(required, provinceValues) {
  if (!required || typeof required !== 'object') {
    return false;
  }
  
  // Если объект пустой, возвращаем true (отсутствие ограничений)
  if (Object.keys(required).length === 0) {
    return true;
  }
  
  // Проверяем, что provinceValues является массивом
  if (!Array.isArray(provinceValues)) {
    return false;
  }
  
  // Приводим все элементы provinceValues к верхнему регистру и обрезаем пробелы
  const normalizedValues = provinceValues.map(v => v.trim().toUpperCase());
  
  // Предполагаем, что required содержит только один оператор на уровне объекта
  const operators = Object.keys(required);
  if (operators.length !== 1) {
    return false;
  }
  
  const operator = operators[0].toUpperCase();
  const operands = required[operators[0]];
  
  switch (operator) {
    case 'AND':
      // Все операнды должны быть истинными
      return operands.every(item => {
        if (typeof item === 'string') {
          return normalizedValues.includes(item.toUpperCase());
        } else if (typeof item === 'object') {
          return evaluateTextCriteria(item, provinceValues);
        }
        return false;
      });
      
    case 'OR':
      // Хотя бы один операнд должен быть истинным
      return operands.some(item => {
        if (typeof item === 'string') {
          return normalizedValues.includes(item.toUpperCase());
        } else if (typeof item === 'object') {
          return evaluateTextCriteria(item, provinceValues);
        }
        return false;
      });
      
    case 'NOT':
      // Один операнд, должен быть ложным
      if (!Array.isArray(operands) || operands.length !== 1) {
        return false;
      }
      const operandNot = operands[0];
      if (typeof operandNot === 'string') {
        return !normalizedValues.includes(operandNot.toUpperCase());
      } else if (typeof operandNot === 'object') {
        return !evaluateTextCriteria(operandNot, provinceValues);
      }
      return false;
      
    case 'XOR':
      // Требуется, чтобы ровно один операнд был истинным
      let trueCount = 0;
      operands.forEach(item => {
        if (typeof item === 'string') {
          if (normalizedValues.includes(item.toUpperCase())) {
            trueCount += 1;
          }
        } else if (typeof item === 'object') {
          if (evaluateTextCriteria(item, provinceValues)) {
            trueCount += 1;
          }
        }
      });
      return (trueCount === 1);
      
    case 'NAND':
      // NAND = NOT (AND)
      const andResult = operands.every(item => {
        if (typeof item === 'string') {
          return normalizedValues.includes(item.toUpperCase());
        } else if (typeof item === 'object') {
          return evaluateTextCriteria(item, provinceValues);
        }
        return false;
      });
      return !andResult;
      
    case 'NOR':
      // NOR = NOT (OR)
      const orResult = operands.some(item => {
        if (typeof item === 'string') {
          return normalizedValues.includes(item.toUpperCase());
        } else if (typeof item === 'object') {
          return evaluateTextCriteria(item, provinceValues);
        }
        return false;
      });
      return !orResult;
      
    default:
      return false;
  }
}

/**
 * Универсальная функция для оценки числовых условий
 * Поддерживаются операторы GREATER_THAN, LESS_THAN, EQUAL_TO, GREATER_OR_EQUAL_TO, LESS_OR_EQUAL_TO, BETWEEN
 * @param {Object} required - Объект с оператором и операндом(ами)
 * @param {number} current - Текущее значение поля провинции
 * @param {string} fieldName - Название поля для логирования
 * @returns {boolean} - Результат оценки условия
 */
function evaluateNumberCriteria(required, current, fieldName) {
  if (!required || typeof required !== 'object') {
    return false;
  }
  
  // Если объект пустой, возвращаем true (отсутствие ограничений)
  if (Object.keys(required).length === 0) {
    return true;
  }
  
  const operators = Object.keys(required);
  if (operators.length !== 1) {
    return false;
  }
  
  const operator = operators[0].toUpperCase();
  const operand = required[operators[0]];
  
  switch (operator) {
    case 'GREATER_THAN':
      return current > operand;
    case 'LESS_THAN':
      return current < operand;
    case 'EQUAL_TO':
      return current === operand;
    case 'GREATER_OR_EQUAL_TO':
      return current >= operand;
    case 'LESS_OR_EQUAL_TO':
      return current <= operand;
    case 'BETWEEN':
      if (Array.isArray(operand) && operand.length === 2) {
        const [min, max] = operand;
        return current >= min && current <= max;
      } else {
        return false;
      }
    // Добавьте дополнительные операторы по необходимости
    default:
      return false;
  }
}