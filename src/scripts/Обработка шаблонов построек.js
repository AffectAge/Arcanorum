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
  const namedRanges = ['Переменные', 'Постройки_Шаблоны', 'Провинции_ОсновнаяИнформация'];
  
  // Объект для хранения данных из диапазонов
  let data = {};
  
  try {
    // Чтение данных из каждого именованного диапазона
    namedRanges.forEach(rangeName => {
      const range = spreadsheet.getRangeByName(rangeName);
      if (range) {
        data[rangeName] = range.getValues();
        // Сообщение об успешном чтении данных (можно добавить информативное сообщение при необходимости)
      } else {
        const errorMsg = `Диапазон с именем "${rangeName}" не найден.`;
        // Добавляем сообщение об ошибке в Журнал_Событий
        addMessagesToRange4([`[Ошибка] ${errorMsg}`], spreadsheet);
        throw new Error(errorMsg);
      }
    });
    
    // Передача данных во вторую функцию для обработки
    processTurn(data, sheet, spreadsheet);
    
  } catch (error) {
    // Добавление сообщения об ошибке в Журнал_Событий
    const errorMessage = `[Ошибка] scanNamedRanges: ${error.message}`;
    addMessagesToRange4([errorMessage], spreadsheet);
    // Дополнительная обработка ошибки при необходимости
  }
}

/**
 * Функция для обработки данных и вызова необходимых подфункций
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист
 * @param {Spreadsheet} spreadsheet - Активная таблица
 */
function processTurn(data, sheet, spreadsheet) {
  try {
    // Вызов функции для парсинга и обработки JSON данных
    const { updatedData, newMessages } = processBuildingsCriterias(data, sheet, spreadsheet);
    
    // Добавление новых сообщений в Журнал_Событий с учетом лимита и категорий
    if (newMessages.length > 0) {
      addMessagesToRange4(newMessages, spreadsheet);
    }
    
    // После обработки данных передаем их в функцию для записи (исключая Журнал_Событий)
    updateRanges(updatedData, spreadsheet);
    
  } catch (error) {
    // Добавление сообщения об ошибке в Журнал_Событий
    const errorMessage = `[Ошибка] processTurn: ${error.message}`;
    addMessagesToRange4([errorMessage], spreadsheet);
    // Дополнительная обработка ошибки при необходимости
  }
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
        continue;
      }
      
      const range = spreadsheet.getRangeByName(rangeName);
      if (range) {
        range.setValues(updatedData[rangeName]);
      } else {
        const errorMsg = `Диапазон с именем "${rangeName}" не найден при записи данных.`;
        // Добавляем сообщение об ошибке в Журнал_Событий
        logErrorToEventLog(errorMsg, spreadsheet);
      }
    }
  }
}