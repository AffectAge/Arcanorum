/**
 * Основная функция для чтения, обработки и записи данных
 */
function scanNamedRanges() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet(); // Получаем активный лист
  
  // Список именованных диапазонов, которые нужно прочитать (исключаем Журнал_Событий)
  const namedRanges = ['Переменные_Основные', 'Постройки_Шаблоны', 'Провинции_ОсновнаяИнформация', 'Постройки_ОсновнаяИнформация', 'Население_ОсновнаяИнформация'];
  
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
/**
 * Функция для обработки данных и вызова необходимых подфункций
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист
 * @param {Spreadsheet} spreadsheet - Активная таблица
 */
function processTurn(data, sheet, spreadsheet) {
  let allNewMessages = [];
  
  try {
    allNewMessages = allNewMessages.concat(processBuildingsCriterias(data, sheet, spreadsheet));
    allNewMessages = allNewMessages.concat(updateProvinceRequiredBuildings(data, spreadsheet));
    allNewMessages = allNewMessages.concat(updateStateRequiredBuildings(data, spreadsheet));
    allNewMessages = allNewMessages.concat(processWorldLimits(data, sheet, spreadsheet));
    allNewMessages = allNewMessages.concat(processStateLimits(data, sheet, spreadsheet));
    allNewMessages = allNewMessages.concat(processProvinceLimits(data, sheet, spreadsheet));
    allNewMessages = allNewMessages.concat(aggregatePopulationDataWithInterestGroupDetails(data, sheet, spreadsheet));
    allNewMessages = allNewMessages.concat(processArableLandRequirements(data, sheet, spreadsheet));
    
    // Фильтрация сообщений
    allNewMessages = allNewMessages.filter(msg => typeof msg === 'string');
    
    // Добавление сообщений в Журнал_Событий
    if (allNewMessages.length > 0) {
      addMessagesToRange4(allNewMessages, spreadsheet);
    }
    
    // Обновление диапазонов
    updateRanges(data, spreadsheet);
    
  } catch (error) {
    const errorMessage = `[Ошибка] processTurn: ${error.message}`;
    addMessagesToRange4([errorMessage], spreadsheet);
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