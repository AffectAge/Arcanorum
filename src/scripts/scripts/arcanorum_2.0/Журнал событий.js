/**
 * Максимальные ограничения
 */
const MAX_TOTAL_MESSAGES = 1000;        // Общий лимит сообщений
const MAX_CHARACTERS_PER_CELL = 50000;  // Лимит символов на ячейку

/**
 * Карта приоритетов категорий
 * Меньшее число означает более высокий приоритет
 */
const CATEGORY_PRIORITY = {
  "Ошибка": 1,
  "Предупреждение": 2,
  "Постройки": 3,
  // Добавьте другие категории и их приоритеты здесь
};

/**
 * Список отключённых категорий
 * Добавьте названия категорий, которые необходимо отключить
 */
const DISABLED_CATEGORIES = [
  // Например, чтобы отключить категории "Предупреждение" и "Постройки", добавьте их сюда
  // "Предупреждение",
  // "Ошибка"
];

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
  
  // Необходимо удалить излишние сообщения
  const excessMessages = totalMessages - MAX_TOTAL_MESSAGES;
  
  // Удаляем излишние сообщения начиная с конца
  const limitedMessages = finalMessages.slice(0, MAX_TOTAL_MESSAGES);
  
  // Добавляем уведомление о превышении лимита
  limitedMessages.push(`Достигнут лимит в ${MAX_TOTAL_MESSAGES} сообщений. Некоторые сообщения были опущены.`);
  
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
    // Если диапазон не найден, невозможно добавить сообщение. Можно рассмотреть возможность создания диапазона или уведомления администратора.
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
  } else {
    // Иначе записываем только необходимые строки
    range.offset(0, 0, numRowsToWrite, 1).setValues(messagesForSheet);
  }
  
  // Включаем перенос текста (Wrap Text) для Журнал_Событий, чтобы отображались переводы строк
  range.setWrap(true);
}
