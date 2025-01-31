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
/**
 * Основная функция обработки хода
 */
function processTurn(data, sheet, spreadsheet) {
  let allNewMessages = [];
  
  try {
    // Массив с описанием функций для вызова
    const functionsToRun = [
      { name: 'Обработка основных критериев построек', func: () => processBuildingsCriterias(data, sheet, spreadsheet) },
      { name: 'Критерии соседства зданий в провинции', func: () => updateProvinceRequiredBuildings(data, spreadsheet) },
      { name: 'Критерии соседства зданий в государстве', func: () => updateStateRequiredBuildings(data, spreadsheet) },
      { name: 'Копирование подходящих провинций', func: () => copyMatchingProvincesToAllowed(data, spreadsheet) },
      { name: 'Обработка лимита построек на провинцию', func: () => processProvinceLimits(data, spreadsheet) },
      { name: 'Обработка лимита построек на государство', func: () => processStateLimits(data, spreadsheet) },
      { name: 'Обработка лимита построек на мир', func: () => processWorldLimits(data, spreadsheet) },
      { name: 'Обработка критериев наличия ресурсов', func: () => processRequiredResources(data, spreadsheet) },
      { name: 'Обработка агрокультурных земель', func: () => processArableLandRequirements(data, spreadsheet) },
      { name: 'Обработка критериев наличия рабочих', func: () => processRequiredWorkers(data, spreadsheet) },
      { name: 'Построение транспортных маршрутов', func: () => updateResourcesAvailable(data, spreadsheet) }
    ];

    // Выполнение всех функций по порядку
    for (let i = 0; i < functionsToRun.length; i++) {
      const { name, func } = functionsToRun[i];
      try {
        const start = Date.now();
        const result = func();
        const duration = ((Date.now() - start)/1000).toFixed(3);
        allNewMessages.push(`[Система] ${name} выполнена за ${duration} сек.`);
        
        if (Array.isArray(result)) {
          allNewMessages.push(...result);
        }
      } catch (error) {
        allNewMessages.push(`[Ошибка] В функции ${name}: ${error.message}`);
      }
    }

    // Разделение сообщений на два журнала
    const standardMessages = [];
    const gnnMessages = [];
    
    allNewMessages.forEach(msg => {
      if (typeof msg === 'string') {
        if (msg.startsWith('[GNN]')) {
          const cleanMsg = msg.slice(5).trim(); // Удаляем [GNN]
          gnnMessages.push(cleanMsg);
        } else {
          standardMessages.push(msg);
        }
      }
    });

    // Запись в журналы
    if (standardMessages.length > 0) {
      addMessagesToRange4(standardMessages, spreadsheet);
    }
    if (gnnMessages.length > 0) {
      addMessagesToRange5(gnnMessages, spreadsheet);
    }

    // Обновление данных
    updateRanges(data, spreadsheet);

  } catch (error) {
    const errorMessage = `[Критическая Ошибка] processTurn: ${error.message}`;
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