/**
 * Функция для обновления статуса зданий на основе шаблонов и провинций.
 * 
 * Алгоритм:
 * 1. Находим stateName из "Переменные".
 * 2. Читаем все шаблоны из "Постройки_Шаблоны" и создаём карту templateMap: { [template.name]: template }.
 * 3. Для каждого здания из "Постройки_ОсновнаяИнформация":
 *    - Если building_owner == stateName:
 *      - Получаем template по building.building_name.
 *      - Проверяем province_id здания в template.matching_provinces_state или template.matching_provinces_others.
 *      - Устанавливаем status = "Активная", если нашли, иначе "Неактивная".
 *      - Формируем соответствующие сообщения.
 * 4. Сохраняем обновленные данные.
 * 
 * @param {Object} data - Объект с данными из именованных диапазонов Google Sheets.
 * @returns {Array} messages - Список сообщений для журнала событий.
 */
function updateBuildingsStatuses(data) {
  let messages = [];

  // 1. Извлекаем stateName из "Переменные"
  let stateName;
  try {
    const targetIdentifier = 'Основные данные государства';
    const rangeVars = data['Переменные'] || [];
    const targetRow = rangeVars.find(row => row[0] === targetIdentifier);

    if (!targetRow || !targetRow[1]) {
      messages.push(`[Ошибка][updateBuildingsStatuses] Идентификатор "${targetIdentifier}" не найден или пуст в "Переменные".`);
      return messages;
    }

    const jsonMatch = targetRow[1].match(/\{.*\}/);
    if (!jsonMatch) {
      messages.push(`[Ошибка][updateBuildingsStatuses] Не удалось извлечь JSON из строки "${targetIdentifier}".`);
      return messages;
    }

    const variablesJson = JSON.parse(jsonMatch[0]);
    if (!variablesJson.state_name) {
      messages.push('[Ошибка][updateBuildingsStatuses] Ключ "state_name" не найден в JSON-переменных.');
      return messages;
    }

    stateName = variablesJson.state_name;
  } catch (err) {
    messages.push(`[Ошибка][updateBuildingsStatuses] При парсинге "Переменные": ${err.message}`);
    return messages;
  }

  // 2. Считываем шаблоны из "Постройки_Шаблоны" в map
  const templateMap = {};
  const templatesData = data['Постройки_Шаблоны'] || [];
  templatesData.forEach((row, rowIndex) => {
    const cell = row[0];
    if (!cell || cell.trim() === '') return;

    try {
      const templateObj = JSON.parse(cell);
      if (templateObj && templateObj.name) {
        templateMap[templateObj.name] = templateObj;
      } else {
        messages.push(`[Ошибка][updateBuildingsStatuses] В строке ${rowIndex + 1} шаблон не содержит "name".`);
      }
    } catch (err) {
      messages.push(`[Ошибка][updateBuildingsStatuses] Парсинг JSON в строке ${rowIndex + 1}: ${err.message}`);
    }
  });

  // Если нет шаблонов - выходим
  if (Object.keys(templateMap).length === 0) {
    messages.push('[Ошибка][updateBuildingsStatuses] Нет корректных шаблонов в "Постройки_Шаблоны".');
    return messages;
  }

  // 3. Считываем здания из "Постройки_ОсновнаяИнформация"
  const buildingsData = data['Постройки_ОсновнаяИнформация'] || [];
  buildingsData.forEach((row, rowIndex) => {
    const cell = row[0];
    if (!cell || cell.trim() === '') return;

    let buildingsArray;
    try {
      buildingsArray = JSON.parse(cell);
    } catch (err) {
      messages.push(`[Ошибка][updateBuildingsStatuses] Парсинг JSON зданий в строке ${rowIndex + 1}: ${err.message}`);
      return;
    }

    let updated = false;
    buildingsArray.forEach(building => {
      // Проверяем, принадлежит ли здание нашему государству
      if (building.building_owner !== stateName) {
        return; // Пропускаем, если не наш владелец
      }

      // Находим шаблон для данного building_name
      const buildingName = building.building_name;
      const template = templateMap[buildingName];
      if (!template) {
        messages.push(`[Предупреждение] Для здания "${buildingName}" нет шаблона в "Постройки_Шаблоны".`);
        return;
      }

      // Проверяем province_id здания на вхождение в matching_provinces_state / matching_provinces_others
      const provinceId = building.province_id;
      const isInStateList = template.matching_provinces_state?.includes(provinceId);
      const isInOthersList = template.matching_provinces_others?.includes(provinceId);

      if (isInStateList || isInOthersList) {
        building.status = "Активная";
        messages.push(
          `[Здание][updateBuildingsStatuses] Здание "${buildingName}" (province_id=${provinceId}) ` +
          `установлено в статус "Активная". Провинция подходит по критериям.`
        );
      } else {
        building.status = "Неактивная";
        messages.push(
          `[Здание][updateBuildingsStatuses] Здание "${buildingName}" (province_id=${provinceId}) ` +
          `установлено в статус "Неактивная". Провинция не подходит по критериям.`
        );
      }

      updated = true;
    });

    // Если были изменения - сохраняем обновлённый массив зданий обратно
    if (updated) {
      row[0] = JSON.stringify(buildingsArray);
    }
  });

  return messages;
}
