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
    // Функции на ограничение работы зданий(Шаблоны зданий)
    // Обработка основных критериев построек
    allNewMessages = allNewMessages.concat(processBuildingsCriterias(data, sheet, spreadsheet));
    // Обработка критериев наличия необходимых построек в провинции
    allNewMessages = allNewMessages.concat(updateProvinceRequiredBuildings(data, spreadsheet));
    // Обработка критериев наличия необходимых построек в государстве
    allNewMessages = allNewMessages.concat(updateStateRequiredBuildings(data, spreadsheet));
    // Обработка критериев наличия необходимого количества агрокультурных земель для строительства
    allNewMessages = allNewMessages.concat(processArableLandRequirements(data, spreadsheet));

    // ВАЖНО! Копирование списка провинций подходящих для работы в список провинций подходящих для строительства(Шаблоны зданий)
    // ВАЖНО! Затем идут функции для обработки ограничений на строительство, они должны идти всегда после функций на ограничение работы зданий
    allNewMessages = allNewMessages.concat(copyMatchingProvincesToAllowed(data, spreadsheet));
    // Обработка лимита построек на провинцию
    allNewMessages = allNewMessages.concat(processProvinceLimits(data, spreadsheet));
    // Обработка лимита построек на государство
    allNewMessages = allNewMessages.concat(processStateLimits(data, spreadsheet));
    // Обработка лимита построек на мир
    allNewMessages = allNewMessages.concat(processWorldLimits(data, spreadsheet));
    // Обработка критериев наличия ресурсов
    allNewMessages = allNewMessages.concat(processRequiredResources(data, spreadsheet));

    
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