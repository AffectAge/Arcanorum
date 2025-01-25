/**
 * Загружает настройки из именованного диапазона "Настройки".
 * @param {Spreadsheet} spreadsheet - Объект активной таблицы.
 * @returns {Object} - Объект с загруженными настройками.
 */
function loadSettings(spreadsheet) {
  const rangeName = 'Настройки';
  const range = spreadsheet.getRangeByName(rangeName);
  
  if (!range) {
    throw new Error(`Диапазон с именем "${rangeName}" не найден.`);
  }
  
  const values = range.getValues();
  const settings = {};
  
  values.forEach(row => {
    const identifier = row[0];
    const data = row[1];
    
    if (identifier && data) {
      try {
        // Попытка парсинга как JSON
        settings[identifier] = JSON.parse(data);
      } catch (e) {
        // Если парсинг не удался, возможно это простой тип (число, строка)
        if (!isNaN(data)) {
          settings[identifier] = Number(data);
        } else {
          settings[identifier] = data;
        }
      }
    }
  });
  
  return settings;
}

/**
 * Получение активной таблицы и загрузка настроек
 */
const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
const settings = loadSettings(spreadsheet);

/**
 * Максимальные ограничения - загружаются из настроек
 */
const MAX_TOTAL_MESSAGES = settings['Максимальное количество сообщений'] || 1000;        // Общий лимит сообщений
const MAX_CHARACTERS_PER_CELL = settings['Максимальное количество символов на ячейку'] || 50000;  // Лимит символов на ячейку

/**
 * Карта приоритетов категорий - загружается из настроек
 */
const CATEGORY_PRIORITY = settings['Приоритет категорий'] || {
  "Ошибка": 1,
  "Предупреждение": 2,
  "Постройки": 3,
  // Добавьте другие категории и их приоритеты здесь
};

/**
 * Список отключённых категорий - загружается из настроек
 */
const DISABLED_CATEGORIES = settings['Отключённые категории'] || [
  // Например, чтобы отключить категории "Предупреждение" и "Постройки", добавьте их сюда
  // "Предупреждение",
  // "Ошибка"
];

/**
 * Слова и соответствующие им цвета для цветовой маркировки - загружаются из настроек
 */
const WORD_COLORS = settings['Цвета слов'] || {
  "Ошибка": "#FF0000"        // Красный
  // Добавьте другие слова и цвета по необходимости
};

/**
 * Цвета категорий - загружаются из настроек
 */
let CATEGORY_COLORS = settings['Цвета категорий'] || {
  "Ошибка": "#FF0000",        // Красный
  "Предупреждение": "#FFA500", // Оранжевый
  "Постройки": "#0000FF",     // Синий
  "Другие категории": "#000000" // Черный
  // Добавьте другие категории и их цвета здесь
};

/**
 * Извлечение дефолтного цвета категорий и удаление его из CATEGORY_COLORS
 */
const DEFAULT_CATEGORY_COLOR = CATEGORY_COLORS['default'] || "#000000"; // Черный по умолчанию
delete CATEGORY_COLORS['default']; // Удаляем ключ 'default' из CATEGORY_COLORS

/**
 * Вспомогательная функция для добавления сообщений об ошибках
 * @param {string} message - Сообщение об ошибке
 * @param {Spreadsheet} spreadsheet - Объект активной таблицы
 */
function logErrorToEventLog(message, spreadsheet) {
  addMessagesToRange4([`[Ошибка] ${message}`], spreadsheet);
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
    
    // Пропускаем сообщения из отключённых категорий
    if (DISABLED_CATEGORIES.includes(category)) {
      return;
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
      // Пропускаем отключённые категории
      if (DISABLED_CATEGORIES.includes(category)) {
        continue;
      }
      
      if (!merged[category]) {
        merged[category] = [];
      }
      merged[category] = merged[category].concat(newMsgs[category]);
    }
  }
  
  return merged;
}

/**
 * Функция для группировки сообщений по категориям с учетом лимита символов на ячейку и приоритетов категорий
 * @param {Object} categorizedMessages - Объект с категориями и массивами сообщений
 * @returns {Array} - Массив сгруппированных сообщений с префиксом категории и переводами строк
 */
function groupMessagesByCategory(categorizedMessages) {
  const finalMessages = [];
  
  // Получаем массив категорий и сортируем их по приоритету
  const sortedCategories = Object.keys(categorizedMessages).sort((a, b) => {
    const priorityA = CATEGORY_PRIORITY[a] || Number.MAX_SAFE_INTEGER; // Если приоритета нет, ставим низкий приоритет
    const priorityB = CATEGORY_PRIORITY[b] || Number.MAX_SAFE_INTEGER;
    return priorityA - priorityB;
  });
  
  sortedCategories.forEach(category => {
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
  });
  
  return finalMessages;
}

/**
 * Функция для обеспечения соблюдения общего лимита на количество сообщений
 * @param {Array} finalMessages - Массив сгруппированных сообщений
 * @returns {Array} - Массив сообщений, не превышающий общий лимит
 */
function enforceTotalMessageLimit(finalMessages) {
  let totalMessages = finalMessages.length;
  
  if (totalMessages <= MAX_TOTAL_MESSAGES) {
    return finalMessages;
  }
  
  // Сортировка по приоритету: сначала более высокие приоритеты (меньшие числа)
  finalMessages.sort((a, b) => {
    const categoryA = a.match(/^\[(.*?)\]/)[1];
    const categoryB = b.match(/^\[(.*?)\]/)[1];
    const priorityA = CATEGORY_PRIORITY[categoryA] || Number.MAX_SAFE_INTEGER;
    const priorityB = CATEGORY_PRIORITY[categoryB] || Number.MAX_SAFE_INTEGER;
    return priorityA - priorityB;
  });
  
  // Оставляем только первые MAX_TOTAL_MESSAGES сообщений
  const limitedMessages = finalMessages.slice(0, MAX_TOTAL_MESSAGES);
  
  // Добавляем уведомление о превышении лимита, если оно ещё не добавлено
  if (!limitedMessages.some(msg => msg.includes('Достигнут лимит'))) {
    limitedMessages.push(`Достигнут лимит в ${MAX_TOTAL_MESSAGES} сообщений. Некоторые сообщения были опущены.`);
  }
  
  return limitedMessages;
}

/**
 * Применяет цветовую маркировку к указанным словам в сообщении с учетом цвета категории.
 * @param {string} message - Текст сообщения.
 * @returns {RichTextValue} - Объект RichTextValue с применёнными цветами.
 */
function applyWordColors(message) {
  // Извлекаем категорию из сообщения
  const categoryMatch = message.match(/^\[(.*?)\]/);
  const category = categoryMatch ? categoryMatch[1] : null;
  const categoryColor = CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLOR;
  
  // Создаём новый RichTextValueBuilder и устанавливаем текст сообщения
  let builder = SpreadsheetApp.newRichTextValue().setText(message);
  
  // Применяем цвет категории ко всему сообщению
  builder = builder.setTextStyle(0, message.length, SpreadsheetApp.newTextStyle().setForegroundColor(categoryColor).build());
  
  // Проходим по всем словам и их соответствующим цветам
  for (const [word, color] of Object.entries(WORD_COLORS)) {
    // Используем регулярное выражение для поиска всех вхождений слова (регистронезависимый)
    const regex = new RegExp(word, 'gi');
    let match;
    while ((match = regex.exec(message)) !== null) {
      const foundIndex = match.index;
      const foundWord = match[0];
      
      // Применяем цвет к найденному слову
      builder = builder.setTextStyle(foundIndex, foundIndex + foundWord.length, SpreadsheetApp.newTextStyle().setForegroundColor(color).build());
      
      // Продолжаем поиск
    }
  }

  // Строим и возвращаем RichTextValue
  return builder.build();
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
    // Если диапазон не найден, невозможно добавить сообщение. Добавляем ошибку в журнал.
    logErrorToEventLog(`Диапазон "${rangeName}" не найден.`, spreadsheet);
    return;
  }
  
  const sheet = range.getSheet(); // Получаем лист, на котором находится Журнал_Событий
  
  range.clearContent(); // Очищаем Журнал_Событий перед записью новых данных
  
  // Получаем существующие сообщения из Журнал_Событий
  const existingData = range.getValues(); // Двумерный массив
  const existingMessages = existingData
    .flat() // Преобразуем двумерный массив в одномерный
    .filter(msg => msg && msg.toString().trim() !== ''); // Убираем пустые ячейки
  
  // Разбиваем существующие сообщения на категории
  const categorizedExistingMessages = categorizeMessages(existingMessages);
  
  // Разбиваем новые сообщения на категории
  const categorizedNewMessages = categorizeMessages(messagesToAdd);
  
  // Объединяем существующие и новые сообщения по категориям
  const combinedCategorizedMessages = mergeCategorizedMessages(categorizedExistingMessages, categorizedNewMessages);
  
  // Группируем сообщения по категориям с учетом лимита символов на ячейку и приоритетов категорий
  const finalMessages = groupMessagesByCategory(combinedCategorizedMessages);
  
  // Учитываем общий лимит на количество сообщений
  const limitedFinalMessages = enforceTotalMessageLimit(finalMessages);
  
  // Преобразуем массив сообщений в двумерный массив для записи с применением цветовой маркировки
  const messagesForSheet = limitedFinalMessages.map(msg => [applyWordColors(msg)]);
  
  // Записываем обновленные сообщения обратно в Журнал_Событий
  // Проверяем, достаточно ли строк в Журнал_Событий для записи
  const numRowsToWrite = messagesForSheet.length;
  const maxRows = range.getNumRows();
  
  if (numRowsToWrite > maxRows) {
    // Если строк недостаточно, расширяем диапазон
    const newRange = sheet.getRange(range.getRow(), range.getColumn(), numRowsToWrite, 1);
    newRange.setRichTextValues(messagesForSheet);
  } else {
    // Иначе записываем только необходимые строки
    range.offset(0, 0, numRowsToWrite, 1).setRichTextValues(messagesForSheet);
  }
  
  // Включаем перенос текста (Wrap Text) для Журнал_Событий, чтобы отображались переводы строк
  range.setWrap(true);
}
