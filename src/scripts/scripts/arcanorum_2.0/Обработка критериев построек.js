/**
 * Максимальные ограничения
 */
const MAX_TOTAL_MESSAGES = 1000;        // Общий лимит сообщений
const MAX_CHARACTERS_PER_CELL = 50000;  // Лимит символов на ячейку

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
    buildingKey: 'required_planet',     // Ключ из шаблона постройки
    provinceKey: 'planet',               // Соответствующий ключ из провинции
    evaluator: evaluateTextCriteria      // Функция для оценки условия
  },
  {
    buildingKey: 'required_rad',
    provinceKey: 'rad',
    evaluator: evaluateNumberCriteria     // Функция для оценки условия
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
  
  // Объект для хранения обновленных данных
  let updatedData = JSON.parse(JSON.stringify(data)); // Глубокое копирование
  let newMessages = []; // Массив для хранения новых сообщений
  
  // Проверяем наличие данных в Переменные_Основные
  if (!range1Data || range1Data.length === 0 || !range1Data[0][0]) {
    const errorMsg = 'Переменные_Основные пуст или не содержит данных.';
    newMessages.push(`[Ошибка] ${errorMsg}`);
    return { updatedData, newMessages }; // Возвращаем без изменений
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
        newMessages.push(`[Ошибка] ${errorMsg}`);
        return { updatedData, newMessages };
      }
    } else {
      throw new Error('Не удалось извлечь JSON из содержимого Переменные_Основные.');
    }
  } catch (e) {
    const errorMsg = `Ошибка при парсинге JSON из Переменные_Основные: ${e.message}`;
    newMessages.push(`[Ошибка] ${errorMsg}`);
    return { updatedData, newMessages };
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
        newMessages.push(`[Ошибка] ${errorMsg}`);
        // Игнорируем ошибку и продолжаем
      }
    }
  }
  
  if (templates.length === 0) {
    const errorMsg = 'Нет корректных шаблонов в Постройки_Шаблоны для обработки.';
    newMessages.push(`[Ошибка] ${errorMsg}`);
    return { updatedData, newMessages };
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
        newMessages.push(`[Ошибка] ${errorMsg}`);
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
    
    // Проходим по каждой провинции и проверяем условия
    allProvinces.forEach(province => {
      let allConditionsMet = true;
      
      // Проходим по каждому условию из CHECK_FIELDS
      CHECK_FIELDS.forEach(checkField => {
        const buildingCondition = template[checkField.buildingKey];
        const provinceValue = province[checkField.provinceKey];
        
        if (buildingCondition !== undefined && buildingCondition !== null) {
          // Если условие определено, оцениваем его
          const result = checkField.evaluator(buildingCondition, provinceValue);
          
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
    const constructionName = template.name ? `"${template.name}"` : `"Неизвестно"`;
    const constructionOwner = template.owner ? `"${template.owner}"` : `"Неизвестно"`;
    
    if (matchingProvincesState.length > 0 || matchingProvincesOthers.length > 0) {
      // Если есть подходящие провинции, генерируем сообщение о возможностях
      let message = `[Постройки]\nПостройка ${constructionName}, принадлежащая ${constructionOwner}, может быть построена:`;
      
      if (matchingProvincesState.length > 0) {
        const provincesStateList = matchingProvincesState.join(', ');
        message += `\n- В провинциях нашего государства: ${provincesStateList}.`;
      }
      
      if (matchingProvincesOthers.length > 0) {
        const provincesOthersList = matchingProvincesOthers.join(', ');
        message += `\n- В провинциях других государств: ${provincesOthersList}.`;
      }
      
      newMessages.push(message);
    }
    
    if (matchingProvincesState.length === 0 && matchingProvincesOthers.length === 0) {
      // Если ни одна провинция не подходит, генерируем соответствующее сообщение
      let reasons = [];
      CHECK_FIELDS.forEach(checkField => {
        reasons.push(checkField.buildingKey.replace('required_', '').replace('_', ' '));
      });
      const reasonsText = reasons.join(' или ');
      
      const message = `[Постройки]\nПостройка ${constructionName}, принадлежащая ${constructionOwner}, не подходит ни для одной провинции нашего государства или других государств, из-за неподходящего ${reasonsText}.`;
      newMessages.push(message);
    }
    
    // Сериализуем обновленный шаблон обратно в JSON
    updatedData['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
  });
  
  return { updatedData, newMessages };
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