/**
 * Основная функция для чтения, обработки и записи данных
 */
function scanNamedRanges() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet(); // Получаем активный лист
  
  // Список именованных диапазонов, которые нужно прочитать (исключаем Журнал_Событий)
  const namedRanges = ['Переменные_Основные', 'Постройки_Шаблоны', 'Провинции_ОсновнаяИнформация', 'Постройки_ОсновнаяИнформация', 'Население_ОсновнаяИнформация', 'Настройки'];
  
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
    // Обработка критериев наличия необходимого количества агрокультурных земель для строительства
    allNewMessages = allNewMessages.concat(processArableLandRequirements(data, spreadsheet));
    // Обработка критериев наличия необходимого количества рабочих для строительства
    allNewMessages = allNewMessages.concat(processRequiredWorkers(data, spreadsheet));

    // Обработка статистики по населению
    allNewMessages = allNewMessages.concat(aggregatePopulationDataWithInterestGroupDetails(data, spreadsheet));

    allNewMessages = allNewMessages.concat(updateResourcesAvailable(data, spreadsheet));

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
 *
 * @param {Object} updatedData - Объект с обновленными данными
 * @param {Spreadsheet} spreadsheet - Объект активной таблицы
 */
function updateRanges(updatedData, spreadsheet) {
  // Определяем чёрный список диапазонов
  const blacklist = new Set(['Журнал_Событий']);
  
  // Получаем все именованные диапазоны за один вызов API
  const namedRanges = spreadsheet.getNamedRanges();
  
  // Создаём карту для быстрого доступа к диапазонам по имени
  const namedRangeMap = {};
  namedRanges.forEach(namedRange => {
    namedRangeMap[namedRange.getName()] = namedRange.getRange();
  });
  
  // Массив для сбора сообщений об ошибках
  const errorMessages = [];
  
  // Итерация по обновленным данным
  for (const [rangeName, values] of Object.entries(updatedData)) {
    // Пропускаем диапазоны из чёрного списка
    if (blacklist.has(rangeName)) {
      continue;
    }
    
    const range = namedRangeMap[rangeName];
    if (range) {
      try {
        // Устанавливаем значения в диапазон
        range.setValues(values);
      } catch (error) {
        // Сохраняем сообщение об ошибке для последующей обработки
        errorMessages.push(`Ошибка при записи в диапазон "${rangeName}": ${error.message}`);
      }
    } else {
      // Диапазон не найден, добавляем сообщение об ошибке
      errorMessages.push(`Диапазон с именем "${rangeName}" не найден при записи данных.`);
    }
  }
  
  // После завершения всех операций, если есть ошибки, логируем их
  if (errorMessages.length > 0) {
    const combinedErrorMsg = errorMessages.join('\n');
    logErrorToEventLog(combinedErrorMsg, spreadsheet);
  }
  
  // Принудительно отправляем все ожидающие изменения
  SpreadsheetApp.flush();
}