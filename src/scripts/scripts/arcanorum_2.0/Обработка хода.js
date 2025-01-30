/**
 * Основная функция для чтения, обработки и записи данных
 */
function scanNamedRanges() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet(); // Получаем активный лист
  
  // Список именованных диапазонов, которые нужно прочитать (исключаем Журнал_Событий)
  const namedRanges = ['Переменные', 'Постройки_Шаблоны', 'Провинции_ОсновнаяИнформация', 'Постройки_ОсновнаяИнформация', 'Население_ОсновнаяИнформация', 'Настройки'];
  
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
    // Массив с описанием функций для вызова и измерения времени
    const functionsToRun = [
      { name: 'Обработка основных критериев построек', func: () => processBuildingsCriterias(data, sheet, spreadsheet) },
      { name: 'Критерии соседства зданий в провинции', func: () => updateProvinceRequiredBuildings(data, spreadsheet) },
      { name: 'Критерии соседства зданий в государстве', func: () => updateStateRequiredBuildings(data, spreadsheet) },
      // ВАЖНО! Копирование списка провинций подходящих для работы в список провинций подходящих для строительства(Шаблоны зданий)
      // ВАЖНО! Затем идут функции для обработки ограничений на строительство, они должны идти всегда после функций на ограничение работы зданий
      { name: 'Копирование подходящих провинций', func: () => copyMatchingProvincesToAllowed(data, spreadsheet) },
      { name: 'Обработка лимита построек на провинцию', func: () => processProvinceLimits(data, spreadsheet) },
      { name: 'Обработка лимита построек на государство', func: () => processStateLimits(data, spreadsheet) },
      { name: 'Обработка лимита построек на мир', func: () => processWorldLimits(data, spreadsheet) },
      { name: 'Обработка критериев наличия ресурсов в провинции', func: () => processRequiredResources(data, spreadsheet) },
      { name: 'Обработка критериев наличия агрокультурных земель', func: () => processArableLandRequirements(data, spreadsheet) },
      { name: 'Обработка критериев наличия рабочих', func: () => processRequiredWorkers(data, spreadsheet) },
      { name: 'Построение транспортных маршрутов', func: () => updateResourcesAvailable(data, spreadsheet) }
      // Добавляйте новые функции здесь, в нужном порядке
    ];
    
    // Используем обычный цикл for для сохранения порядка
    for (let i = 0; i < functionsToRun.length; i++) {
      const { name, func } = functionsToRun[i];
      try {
        const start = new Date();
        const result = func();
        const end = new Date();
        const duration = end - start; // Время в миллисекундах
        const durationSec = (duration / 1000).toFixed(3);
        allNewMessages.push(`[Выполнение функций] 🛠️${name} выполнена за ⏳${durationSec} секунд`);
        
        // Предполагается, что каждая функция возвращает массив сообщений
        if (Array.isArray(result)) {
          allNewMessages = allNewMessages.concat(result);
        }
      } catch (funcError) {
        const errorMsg = `[Ошибка] ${name}: ${funcError.message}`;
        allNewMessages.push(errorMsg);
        // Можно также логировать ошибки отдельно, если требуется
      }
    }
    
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