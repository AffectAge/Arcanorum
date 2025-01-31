/**
 * Функция для копирования значений ключей matching_provinces_state и matching_provinces_others 
 * в allowed_building_state и allowed_building_others соответственно в шаблонах построек
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Spreadsheet} spreadsheet - Объект активной таблицы
 * @returns {Array} newMessages - Массив новых сообщений для журнала
 */
function copyMatchingProvincesToAllowed(data, spreadsheet) {
  let newMessages = [];

  try {
    // 1. Получение данных из Постройки_Шаблоны
    const templatesData = data['Постройки_Шаблоны'];
    if (!templatesData || templatesData.length === 0) {
      newMessages.push(`[Ошибка][copyMatchingProvincesToAllowed] Постройки_Шаблоны пуст или не содержит данных.`);
      return newMessages;
    }

    // 2. Парсинг шаблонов
    const templates = []; // { data: templateObject, row: rowIndex }
    templatesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const template = JSON.parse(cell);
          if (!template.name) {
            newMessages.push(`[Ошибка][copyMatchingProvincesToAllowed] Шаблон в строке ${index + 1} не содержит ключа "name".`);
            return;
          }

          templates.push({ data: template, row: index });
        } catch (e) {
          newMessages.push(`[Ошибка][copyMatchingProvincesToAllowed] Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${index + 1}: ${e.message}`);
        }
      } else {
        // newMessages.push(`[Ошибка][copyMatchingProvincesToAllowed] Пустая ячейка в Постройки_Шаблоны, строка ${index + 1}.`);
      }
    });

    if (templates.length === 0) {
      newMessages.push(`[Ошибка][copyMatchingProvincesToAllowed] Нет корректных шаблонов в Постройки_Шаблоны для обработки.`);
      return newMessages;
    }

    // 3. Обработка каждого шаблона
    templates.forEach(templateInfo => {
      const template = templateInfo.data;
      const templateName = template.name;
      let updated = false;

      // Копирование matching_provinces_state в allowed_building_state
      if ('matching_provinces_state' in template) {
        template.allowed_building_state = template.matching_provinces_state;
        //newMessages.push(`[DEBUG][Копирование данных] Шаблон "${templateName}": matching_provinces_state скопирован в allowed_building_state.`);
        updated = true;
      } else {
        newMessages.push(`[Ошибка][copyMatchingProvincesToAllowed] Шаблон "${templateName}" не содержит ключа "matching_provinces_state".`);
      }

      // Копирование matching_provinces_others в allowed_building_others
      if ('matching_provinces_others' in template) {
        template.allowed_building_others = template.matching_provinces_others;
        //newMessages.push(`[DEBUG][Копирование данных] Шаблон "${templateName}": matching_provinces_others скопирован в allowed_building_others.`);
        updated = true;
      } else {
        newMessages.push(`[Ошибка][copyMatchingProvincesToAllowed] Шаблон "${templateName}" не содержит ключа "matching_provinces_others".`);
      }

      // Если были изменения, обновляем шаблон в data
      if (updated) {
        try {
          data['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
        } catch (e) {
          newMessages.push(`[Ошибка][copyMatchingProvincesToAllowed] Ошибка при сериализации JSON для шаблона "${templateName}" в строке ${templateInfo.row + 1}: ${e.message}`);
        }
      }
    });

  } catch (error) {
    newMessages.push(`[Ошибка][copyMatchingProvincesToAllowed] copyMatchingProvincesToAllowed: ${error.message}`);
  }

  return newMessages;
}
