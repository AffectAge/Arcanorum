/**
 * Основная функция для чтения, обработки и записи данных
 */
function scanNamedRanges() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  
  // Список именованных диапазонов, которые нужно прочитать
  const namedRanges = ['Range1']; // Замените на ваши именованные диапазоны
  
  // Объект для хранения данных из диапазонов
  let data = {};
  
  // Чтение данных из каждого именованного диапазона
  namedRanges.forEach(rangeName => {
    const range = sheet.getRangeByName(rangeName);
    if (range) {
      data[rangeName] = range.getValues();
    } else {
      Logger.log(`Диапазон с именем "${rangeName}" не найден.`);
    }
  });
  
  // Передача данных во вторую функцию для обработки
  processTurn(data);
}

/**
 * Функция для обработки данных и вызова необходимых подфункций
 * @param {Object} data - Объект с данными из именованных диапазонов
 */
function processTurn(data) {
  // Здесь вы можете вызвать ваши подфункции для обработки данных
  // Пример:
  
  // Обработка данных из Range1
    data['Range1'] = processRange1(data['Range1']);
  
  // После обработки данных передаем их в функцию для записи
  updateRanges(data);
}

/**
 * Пример подфункции для обработки Range1
 * @param {Array} rangeData
 * @returns {Array}
 */
function processRange1(rangeData) {
  // Ваша логика обработки данных Range1
  // Например, добавим 1 к каждому числу
  return rangeData.map(row => row.map(cell => cell + 1));
}

/**
 * Функция для записи обновленных данных обратно в именованные диапазоны
 * @param {Object} updatedData - Объект с обновленными данными
 */
function updateRanges(updatedData) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  
  for (const rangeName in updatedData) {
    if (updatedData.hasOwnProperty(rangeName)) {
      const range = sheet.getRangeByName(rangeName);
      if (range) {
        range.setValues(updatedData[rangeName]);
      } else {
        Logger.log(`Диапазон с именем "${rangeName}" не найден при записи данных.`);
      }
    }
  }
}


