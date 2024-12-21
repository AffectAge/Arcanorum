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
 * Основная функция для чтения, обработки и записи данных
 */
function scanNamedRanges() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet(); // Получаем активный лист
  
  // Список именованных диапазонов, которые нужно прочитать (исключаем Журнал_Событий)
  const namedRanges = ['Переменные_Основные', 'Постройки_Шаблоны', 'Провинции_ОсновнаяИнформация'];
  
  // Объект для хранения данных из диапазонов
  let data = {};
  
  // Чтение данных из каждого именованного диапазона
  namedRanges.forEach(rangeName => {
    const range = spreadsheet.getRangeByName(rangeName);
    if (range) {
      data[rangeName] = range.getValues();
      Logger.log(`Данные прочитаны из ${rangeName}`);
    } else {
      Logger.log(`Диапазон с именем "${rangeName}" не найден.`);
    }
  });
  
  // Передача данных во вторую функцию для обработки
  processTurn(data, sheet, spreadsheet);
}

/**
 * Функция для обработки данных и вызова необходимых подфункций
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист
 * @param {Spreadsheet} spreadsheet - Активная таблица
 */
function processTurn(data, sheet, spreadsheet) {
  // Вызов функции для парсинга и обработки JSON данных
  const { updatedData, newMessages } = processJsonData(data, sheet, spreadsheet);
  
  // Добавление новых сообщений в Журнал_Событий с учетом лимита и категорий
  if (newMessages.length > 0) {
    addMessagesToRange4(newMessages, spreadsheet);
  }
  
  // После обработки данных передаем их в функцию для записи (исключая Журнал_Событий)
  updateRanges(updatedData, spreadsheet);
}

/**
 * Функция для парсинга и обработки JSON данных согласно заданию
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист
 * @param {Spreadsheet} spreadsheet - Активная таблица
 * @returns {Object} - Объект с обновленными данными и новыми сообщениями
 */
function processJsonData(data, sheet, spreadsheet) {
  const range1Data = data['Переменные_Основные'];
  const range2Data = data['Постройки_Шаблоны'];
  const range3Data = data['Провинции_ОсновнаяИнформация'];
  
  // Объект для хранения обновленных данных
  let updatedData = JSON.parse(JSON.stringify(data)); // Глубокое копирование
  let newMessages = []; // Массив для хранения новых сообщений
  
  // Проверяем наличие данных в Переменные_Основные
  if (!range1Data || range1Data.length === 0 || !range1Data[0][0]) {
    Logger.log('Переменные_Основные пуст или не содержит данных.');
    return { updatedData, newMessages }; // Возвращаем без изменений
  }
  
  // Парсим JSON из первой ячейки Переменные_Основные и получаем state_name
  let stateName;
  try {
    const rawData = range1Data[0][0];
    Logger.log(`Содержимое Переменные_Основные, первая ячейка: "${rawData}"`);
    
    // Извлечение JSON с помощью регулярного выражения
    const jsonMatch = rawData.match(/\{.*\}/);
    if (jsonMatch) {
      const range1Json = JSON.parse(jsonMatch[0]);
      stateName = range1Json.state_name;
      Logger.log(`Извлечён state_name: "${stateName}"`);
      if (!stateName) {
        Logger.log('Ключ "state_name" не найден в Переменные_Основные.');
        return { updatedData, newMessages };
      }
    } else {
      throw new Error('Не удалось извлечь JSON из содержимого Переменные_Основные.');
    }
  } catch (e) {
    Logger.log(`Ошибка при парсинге JSON из Переменные_Основные: ${e}`);
    return { updatedData, newMessages };
  }
  
  // Парсим все JSON из Постройки_Шаблоны (шаблоны) без фильтрации по owner
  const templates = [];
  for (let i = 0; i < range2Data.length; i++) {
    const cell = range2Data[i][0];
    if (cell) {
      try {
        const template = JSON.parse(cell);
        Logger.log(`Парсинг Постройки_Шаблоны, строка ${i+1}: ${JSON.stringify(template)}`);
        templates.push({ 
          data: template, 
          row: i 
        });
      } catch (e) {
        Logger.log(`Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${i+1}: ${e}`);
        // Игнорируем ошибку и продолжаем
      }
    }
  }
  
  if (templates.length === 0) {
    Logger.log('Нет корректных шаблонов в Постройки_Шаблоны для обработки.');
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
        Logger.log(`Парсинг Провинции_ОсновнаяИнформация, строка ${i+1}: ${JSON.stringify(province)}`);
        if (province.id) {
          // Автоматическое преобразование полей, использующих evaluateTextCriteria
          TEXT_CRITERIA_KEYS.forEach(key => {
            if (province[key]) {
              if (typeof province[key] === 'string') {
                province[key] = province[key].split(',').map(item => item.trim());
                Logger.log(`Преобразованные ${key} для провинции "${province.id}": ${JSON.stringify(province[key])}`);
              }
              // Если поле уже массив, ничего не делаем
            }
          });
          
          // Преобразуем available_resources в массив, если это строка
          if (province.available_resources && typeof province.available_resources === 'string') {
            province.available_resources = province.available_resources.split(',').map(item => item.trim());
            Logger.log(`Преобразованные available_resources для провинции "${province.id}": ${JSON.stringify(province.available_resources)}`);
          }
          
          provinceMap[province.id] = province;
          allProvinces.push(province);
        }
      } catch (e) {
        Logger.log(`Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${i+1}: ${e}`);
        // Игнорируем ошибку и продолжаем
      }
    }
  }
  
  // Обрабатываем каждый шаблон
  templates.forEach(templateInfo => {
    const template = templateInfo.data;
    Logger.log(`Обработка шаблона из строки ${templateInfo.row + 1}: ${JSON.stringify(template)}`);
    
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
          Logger.log(`Проверка условия "${checkField.buildingKey}" для провинции "${province.id}": ${result}`);
          
          if (!result) {
            allConditionsMet = false;
          }
        } else {
          // Если условие не определено, интерпретируем как отсутствие ограничений (true)
          Logger.log(`Условие "${checkField.buildingKey}" отсутствует. Интерпретируется как true.`);
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
    
    Logger.log(`Шаблон из строки ${templateInfo.row + 1} обновлён с matching_provinces_state: ${matchingProvincesState}, matching_provinces_others: ${matchingProvincesOthers}`);
    
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
      Logger.log(`Сообщение о подходящих провинциях подготовлено: "${message}"`);
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
      Logger.log(`Сообщение о несоответствии подготовлено: "${message}"`);
    }
    
    // Сериализуем обновленный шаблон обратно в JSON
    updatedData['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
  });
  
  return { updatedData, newMessages };
}

/**
 * Функция для категоризации сообщений
 * @param {Array} messages - Массив сообщений
 * @returns {Object} - Объект с категориями как ключами и массивами сообщений как значениями
 */
function categorizeMessages(messages) {
  const categorized = {};
  
  messages.forEach(msg => {
    const match = msg.match(/^\[(.*?)\]\s*(.*)$/);
    let category = "Без категории";
    let text = msg;
    
    if (match) {
      category = match[1];
      text = match[2];
    }
    
    if (!categorized[category]) {
      categorized[category] = [];
    }
    
    categorized[category].push(text);
  });
  
  return categorized;
}

/**
 * Функция для объединения существующих и новых категоризированных сообщений
 * @param {Object} existing - Объект с существующими категориями и сообщениями
 * @param {Object} newMsgs - Объект с новыми категориями и сообщениями
 * @returns {Object} - Объединённый объект с категориями и сообщениями
 */
function mergeCategorizedMessages(existing, newMsgs) {
  const merged = { ...existing };
  
  for (const category in newMsgs) {
    if (newMsgs.hasOwnProperty(category)) {
      if (!merged[category]) {
        merged[category] = [];
      }
      merged[category] = merged[category].concat(newMsgs[category]);
    }
  }
  
  return merged;
}

/**
 * Функция для группировки сообщений по категориям с учетом лимита символов на ячейку
 * @param {Object} categorizedMessages - Объект с категориями и массивами сообщений
 * @returns {Array} - Массив сгруппированных сообщений с префиксом категории и переводами строк
 */
function groupMessagesByCategory(categorizedMessages) {
  const finalMessages = [];
  
  for (const category in categorizedMessages) {
    if (categorizedMessages.hasOwnProperty(category)) {
      const messages = categorizedMessages[category];
      const formattedCategory = `[${category}]`;
      let currentCellText = formattedCategory;
      
      messages.forEach(msg => {
        const additionalText = `\n${msg}`; // Используем перевод строки вместо пробела
        if ((currentCellText + additionalText).length <= MAX_CHARACTERS_PER_CELL) {
          currentCellText += additionalText;
        } else {
          // Если превышен лимит, сохраняем текущую строку и начинаем новую
          finalMessages.push(currentCellText);
          currentCellText = `${formattedCategory}\n${msg}`;
        }
      });
      
      // Добавляем оставшийся текст
      if (currentCellText.length > 0) {
        finalMessages.push(currentCellText);
      }
    }
  }
  
  return finalMessages;
}

/**
 * Функция для обеспечения соблюдения общего лимита на количество сообщений
 * @param {Array} finalMessages - Массив сгруппированных сообщений
 * @returns {Array} - Массив сообщений, не превышающий общий лимит
 */
function enforceTotalMessageLimit(finalMessages) {
  let totalMessages = finalMessages.length;
  
  Logger.log(`Общее количество сообщений перед применением лимита: ${totalMessages}`);
  
  if (totalMessages <= MAX_TOTAL_MESSAGES) {
    Logger.log('Общее количество сообщений в пределах лимита.');
    return finalMessages;
  }
  
  // Необходимо удалить излишние сообщения
  const excessMessages = totalMessages - MAX_TOTAL_MESSAGES;
  Logger.log(`Общее количество сообщений (${totalMessages}) превышает лимит (${MAX_TOTAL_MESSAGES}). Необходимо удалить ${excessMessages} сообщений.`);
  
  // Удаляем излишние сообщения начиная с конца
  const limitedMessages = finalMessages.slice(0, MAX_TOTAL_MESSAGES);
  
  // Добавляем уведомление о превышении лимита
  limitedMessages.push(`Достигнут лимит в ${MAX_TOTAL_MESSAGES} сообщений. Некоторые сообщения были опущены.`);
  
  Logger.log(`Общее количество сообщений после применения лимита: ${limitedMessages.length}`);
  
  return limitedMessages;
}

/**
 * Вспомогательная функция для добавления сообщений в Журнал_Событий с учетом общего лимита и группировки по категориям
 * @param {Array} messagesToAdd - Массив новых сообщений для добавления
 * @param {Spreadsheet} spreadsheet - Объект активной таблицы
 */
function addMessagesToRange4(messagesToAdd, spreadsheet) {
  const rangeName = 'Журнал_Событий';
  
  const range = spreadsheet.getRangeByName(rangeName);
  if (!range) {
    Logger.log(`Диапазон с именем "${rangeName}" не найден.`);
    return;
  }
  
  const sheet = range.getSheet(); // Получаем лист, на котором находится Журнал_Событий
  
  range.clearContent(); // Очищаем Журнал_Событий перед записью новых данных
  
  // Получаем существующие сообщения из Журнал_Событий
  const existingData = range.getValues(); // Двумерный массив
  const existingMessages = existingData
    .flat() // Преобразуем двумерный массив в одномерный
    .filter(msg => msg && msg.toString().trim() !== ''); // Убираем пустые ячейки
  
  Logger.log(`Текущее количество сообщений в Журнал_Событий: ${existingMessages.length}`);
  
  // Разбиваем существующие сообщения на категории
  const categorizedExistingMessages = categorizeMessages(existingMessages);
  
  // Разбиваем новые сообщения на категории
  const categorizedNewMessages = categorizeMessages(messagesToAdd);
  
  // Объединяем существующие и новые сообщения по категориям
  const combinedCategorizedMessages = mergeCategorizedMessages(categorizedExistingMessages, categorizedNewMessages);
  
  // Группируем сообщения по категориям с учетом лимита символов на ячейку
  const finalMessages = groupMessagesByCategory(combinedCategorizedMessages);
  
  // Учитываем общий лимит на количество сообщений
  const limitedFinalMessages = enforceTotalMessageLimit(finalMessages);
  
  // Преобразуем массив сообщений в двумерный массив для записи
  const messagesForSheet = limitedFinalMessages.map(msg => [msg]);
  
  // Записываем обновленные сообщения обратно в Журнал_Событий
  // Проверяем, достаточно ли строк в Журнал_Событий для записи
  const numRowsToWrite = messagesForSheet.length;
  const maxRows = range.getNumRows();
  
  if (numRowsToWrite > maxRows) {
    // Если строк недостаточно, расширяем диапазон
    const newRange = sheet.getRange(range.getRow(), range.getColumn(), numRowsToWrite, 1);
    newRange.setValues(messagesForSheet);
    Logger.log(`Журнал_Событий расширен до ${numRowsToWrite} строк и обновлён.`);
  } else {
    // Иначе записываем только необходимые строки
    range.offset(0, 0, numRowsToWrite, 1).setValues(messagesForSheet);
    Logger.log(`Журнал_Событий обновлен с ${messagesForSheet.length} сообщениями.`);
  }
  
  // Включаем перенос текста (Wrap Text) для Журнал_Событий, чтобы отображались переводы строк
  range.setWrap(true);
  Logger.log(`Перенос текста включён для ${rangeName}.`);
}

/**
 * Функция для записи обновленных данных обратно в именованные диапазоны
 * @param {Object} updatedData - Объект с обновленными данными
 * @param {Spreadsheet} spreadsheet - Объект активной таблицы
 */
function updateRanges(updatedData, spreadsheet) {
  for (const rangeName in updatedData) {
    if (updatedData.hasOwnProperty(rangeName)) {
      // Исключаем Журнал_Событий из обновления
      if (rangeName === 'Журнал_Событий') {
        Logger.log(`Пропуск Журнал_Событий при обновлении данных.`);
        continue;
      }
      
      const range = spreadsheet.getRangeByName(rangeName);
      if (range) {
        range.setValues(updatedData[rangeName]);
        Logger.log(`Данные записаны обратно в ${rangeName}`);
      } else {
        Logger.log(`Диапазон с именем "${rangeName}" не найден при записи данных.`);
      }
    }
  }
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
    Logger.log('Объект условий отсутствует или некорректен.');
    return false;
  }
  
  // Если объект пустой, возвращаем true (отсутствие ограничений)
  if (Object.keys(required).length === 0) {
    Logger.log('Условие пустое. Интерпретируется как true.');
    return true;
  }
  
  // Проверяем, что provinceValues является массивом
  if (!Array.isArray(provinceValues)) {
    Logger.log('provinceValues должен быть массивом.');
    return false;
  }
  
  // Приводим все элементы provinceValues к верхнему регистру и обрезаем пробелы
  const normalizedValues = provinceValues.map(v => v.trim().toUpperCase());
  Logger.log(`Нормализованные значения: ${JSON.stringify(normalizedValues)}`);
  
  // Предполагаем, что required содержит только один оператор на уровне объекта
  const operators = Object.keys(required);
  if (operators.length !== 1) {
    Logger.log('Объект условий должен содержать только один оператор.');
    return false;
  }
  
  const operator = operators[0].toUpperCase();
  const operands = required[operators[0]];
  
  Logger.log(`Оператор: ${operator}, Операнды: ${JSON.stringify(operands)}`);
  
  switch (operator) {
    case 'AND':
      // Все операнды должны быть истинными
      return operands.every(item => {
        if (typeof item === 'string') {
          const result = normalizedValues.includes(item.toUpperCase());
          Logger.log(`Проверка "AND" условия для "${item}": ${result}`);
          return result;
        } else if (typeof item === 'object') {
          const result = evaluateTextCriteria(item, provinceValues);
          Logger.log(`Проверка вложенного "AND" условия: ${result}`);
          return result;
        }
        Logger.log(`Неподдерживаемый тип операнда: ${typeof item}`);
        return false;
      });
      
    case 'OR':
      // Хотя бы один операнд должен быть истинным
      return operands.some(item => {
        if (typeof item === 'string') {
          const result = normalizedValues.includes(item.toUpperCase());
          Logger.log(`Проверка "OR" условия для "${item}": ${result}`);
          return result;
        } else if (typeof item === 'object') {
          const result = evaluateTextCriteria(item, provinceValues);
          Logger.log(`Проверка вложенного "OR" условия: ${result}`);
          return result;
        }
        Logger.log(`Неподдерживаемый тип операнда: ${typeof item}`);
        return false;
      });
      
    case 'NOT':
      // Один операнд, должен быть ложным
      if (!Array.isArray(operands) || operands.length !== 1) {
        Logger.log('Оператор "NOT" должен иметь ровно один операнд.');
        return false;
      }
      const operandNot = operands[0];
      if (typeof operandNot === 'string') {
        const result = !normalizedValues.includes(operandNot.toUpperCase());
        Logger.log(`Проверка "NOT" условия для "${operandNot}": ${result}`);
        return result;
      } else if (typeof operandNot === 'object') {
        const result = !evaluateTextCriteria(operandNot, provinceValues);
        Logger.log(`Проверка вложенного "NOT" условия: ${result}`);
        return result;
      }
      Logger.log(`Неподдерживаемый тип операнда для "NOT": ${typeof operandNot}`);
      return false;
      
    case 'XOR':
      // Требуется, чтобы ровно один операнд был истинным
      let trueCount = 0;
      operands.forEach(item => {
        if (typeof item === 'string') {
          if (normalizedValues.includes(item.toUpperCase())) {
            trueCount += 1;
            Logger.log(`Проверка "XOR" условия для "${item}": true`);
          } else {
            Logger.log(`Проверка "XOR" условия для "${item}": false`);
          }
        } else if (typeof item === 'object') {
          if (evaluateTextCriteria(item, provinceValues)) {
            trueCount += 1;
            Logger.log(`Проверка вложенного "XOR" условия: true`);
          } else {
            Logger.log(`Проверка вложенного "XOR" условия: false`);
          }
        }
      });
      const xorResult = (trueCount === 1);
      Logger.log(`Результат "XOR": ${xorResult}`);
      return xorResult;
      
    case 'NAND':
      // NAND = NOT (AND)
      const andResult = operands.every(item => {
        if (typeof item === 'string') {
          const res = normalizedValues.includes(item.toUpperCase());
          Logger.log(`Проверка "NAND" "AND" условия для "${item}": ${res}`);
          return res;
        } else if (typeof item === 'object') {
          const res = evaluateTextCriteria(item, provinceValues);
          Logger.log(`Проверка вложенного "NAND" "AND" условия: ${res}`);
          return res;
        }
        Logger.log(`Неподдерживаемый тип операнда для "NAND": ${typeof item}`);
        return false;
      });
      const nandResult = !andResult;
      Logger.log(`Результат "NAND": ${nandResult}`);
      return nandResult;
      
    case 'NOR':
      // NOR = NOT (OR)
      const orResult = operands.some(item => {
        if (typeof item === 'string') {
          const res = normalizedValues.includes(item.toUpperCase());
          Logger.log(`Проверка "NOR" "OR" условия для "${item}": ${res}`);
          return res;
        } else if (typeof item === 'object') {
          const res = evaluateTextCriteria(item, provinceValues);
          Logger.log(`Проверка вложенного "NOR" "OR" условия: ${res}`);
          return res;
        }
        Logger.log(`Неподдерживаемый тип операнда для "NOR": ${typeof item}`);
        return false;
      });
      const norResult = !orResult;
      Logger.log(`Результат "NOR": ${norResult}`);
      return norResult;
      
    default:
      Logger.log(`Неизвестный логический оператор: ${operator}`);
      return false;
  }
}

/**
 * Функция для оценки условий по населению
 * @param {Object} required - Объект с необходимыми условиями населения
 * @param {number} current - Текущее население провинции
 * @returns {boolean} - Результат оценки условия
 */
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
    Logger.log(`Объект "required_${fieldName}" отсутствует или некорректен.`);
    return false;
  }
  
  // Если объект пустой, возвращаем true (отсутствие ограничений)
  if (Object.keys(required).length === 0) {
    Logger.log(`Условие "required_${fieldName}" пустое. Интерпретируется как true.`);
    return true;
  }
  
  const operators = Object.keys(required);
  if (operators.length !== 1) {
    Logger.log(`Объект "required_${fieldName}" должен содержать только один оператор.`);
    return false;
  }
  
  const operator = operators[0].toUpperCase();
  const operand = required[operators[0]];
  
  Logger.log(`Оператор для ${fieldName}: ${operator}, Операнд: ${JSON.stringify(operand)}`);
  
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
        Logger.log(`Оператор "BETWEEN" требует массив из двух значений. Получено: ${JSON.stringify(operand)}`);
        return false;
      }
    // Добавьте дополнительные операторы по необходимости
    default:
      Logger.log(`Неизвестный оператор для ${fieldName}: ${operator}`);
      return false;
  }
}
