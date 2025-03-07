/**
 * Функция для перераспределения пашни для построек.
 * Работает со статусом "Активная" и "Неактивная".
 * Если для активной постройки хватает свободной земли, отнимает её у свободных и добавляет к занятым.
 * Если земли недостаточно, постройка получает статус "Неактивная".
 *
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Spreadsheet} spreadsheet - Активная таблица
 * @returns {Array} messages - Массив сообщений для журнала
 */
function processArableLandSimple(data, spreadsheet) {
  let messages = [];
  try {
    // 1. Извлекаем stateName из "Переменные_Основные"
    const variablesData = data['Переменные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      messages.push(`[Ошибка][processArableLandSimple] Переменные пуст или не содержит данных.`);
      return messages;
    }
    // Получаем название государства
    let stateName;
    try {
      const targetRow = variablesData.find(row => row[0] === 'Основные данные государства');
      if (targetRow && targetRow[1]) {
        const jsonMatch = targetRow[1].match(/\{.*\}/);
        if (jsonMatch) {
          const variablesJson = JSON.parse(jsonMatch[0]);
          stateName = variablesJson.state_name;
          if (!stateName) {
            const errMsg = '[❌ Ошибка] Ключ "state_name" отсутствует в "Переменные".';
            messages.push(errMsg);
            return messages;
          }
        } else {
          throw new Error('Не удалось извлечь JSON из "Переменные".');
        }
      } else {
        throw new Error('Идентификатор "Основные данные государства" не найден.');
      }
      messages.push(`🌐 Название государства: ${stateName}`);
    } catch (e) {
      const errMsg = `[❌ Ошибка] Ошибка при извлечении state_name: ${e.message}`;
      messages.push(errMsg);
      return messages;
    }

    // 2. Считываем провинции и формируем карту provinceMap[id] = provinceObject
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      messages.push(`[Ошибка][processArableLandSimple] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
      return messages;
    }
    const provinceMap = {};
    provincesData.forEach((row, pIndex) => {
      const cell = row[0];
      if (!cell) return;
      try {
        let jsonString = cell;
        if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
          jsonString = jsonString.slice(1, -1);
        }
        jsonString = jsonString.replace(/""/g, '"');
        const province = JSON.parse(jsonString);
        if (province.id) {
          provinceMap[province.id] = province;
        } else {
          messages.push(`[Ошибка][processArableLandSimple] Провинция в строке ${pIndex + 1} не содержит ключа "id".`);
        }
      } catch (e) {
        messages.push(`[Ошибка][processArableLandSimple] Ошибка при парсинге JSON провинции в строке ${pIndex + 1}: ${e.message}`);
      }
    });

    // 3. Считываем шаблоны построек: templateMap[name] = templateObject
    const templatesData = data['Постройки_Шаблоны'];
    if (!templatesData || templatesData.length === 0) {
      messages.push(`[Ошибка][processArableLandSimple] Постройки_Шаблоны пуст или не содержит данных.`);
      return messages;
    }
    const templateMap = {};
    templatesData.forEach((row, tIndex) => {
      const cell = row[0];
      if (!cell) return;
      try {
        const template = JSON.parse(cell);
        if (!template.name) {
          messages.push(`[Ошибка][processArableLandSimple] Шаблон в строке ${tIndex + 1} не содержит ключа "name".`);
          return;
        }
        templateMap[template.name] = template;
      } catch (e) {
        messages.push(`[Ошибка][processArableLandSimple] Ошибка при парсинге JSON шаблона в строке ${tIndex + 1}: ${e.message}`);
      }
    });

    // 4. Считываем постройки и обрабатываем их
    const buildingsData = data['Постройки_ОсновнаяИнформация'];
    if (!buildingsData || buildingsData.length === 0) {
      messages.push(`[Ошибка][processArableLandSimple] Постройки_ОсновнаяИнформация пуст или не содержит данных.`);
      return messages;
    }

    buildingsData.forEach((row, bIndex) => {
      const cell = row[0];
      if (!cell) return;
      try {
        const parsedData = JSON.parse(cell);
        const buildingsArray = Array.isArray(parsedData) ? parsedData : [parsedData];

        buildingsArray.forEach((building) => {
          // Проверяем наличие провинции
          const provinceId = building.province_id;
          const province = provinceMap[provinceId];
          if (!province) {
            messages.push(`[Ошибка][processArableLandSimple] Провинция с ID "${provinceId}" не найдена (постройка: "${building.building_name}").`);
            return;
          }

          // Проверяем, принадлежит ли провинция нашему государству
          if (province.owner !== stateName) {
            return;
          }

          // Если статус "Активная", производим перераспределение земли
          if (building.status === "Активная") {
            // Ищем шаблон по имени постройки
            const template = templateMap[building.building_name];
            if (!template) {
              messages.push(`[Ошибка][processArableLandSimple] Не найден шаблон для постройки "${building.building_name}".`);
              return;
            }
            if (typeof template.required_arable_land !== 'number') {
              messages.push(`[Ошибка][processArableLandSimple] Шаблон "${template.name}" не содержит корректного required_arable_land.`);
              return;
            }
            if (typeof building.building_level !== 'number') {
              messages.push(`[Ошибка][processArableLandSimple] Постройка "${building.building_name}" не содержит корректного building_level.`);
              return;
            }

            // land_efficiency, если не задан, по умолчанию 1
            const landEfficiency =
              (building.building_modifiers && typeof building.building_modifiers.land_efficiency === 'number')
              ? building.building_modifiers.land_efficiency
              : 1;

            // Вычисляем требуемое количество земли
            const requiredLand = template.required_arable_land * building.building_level * landEfficiency;

            // Если свободной земли хватает, перераспределяем её
            if (province.free_arable_land >= requiredLand) {
              province.free_arable_land -= requiredLand;
              province.occupied_arable_land += requiredLand;
              building.used_arable_land = requiredLand;
            } else {
              messages.push(`[Внимание][processArableLandSimple] Недостаточно земли для постройки "${building.building_name}" в провинции "${provinceId}". Изменяем статус на "Неактивная".`);
              building.status = "Неактивная";
            }
          }
          // Для статуса "Неактивная" ничего не делаем
        });

        // Сериализуем обратно обновлённые данные по постройкам
        row[0] = JSON.stringify(buildingsArray);
      } catch (e) {
        messages.push(`[Ошибка][processArableLandSimple] Ошибка при парсинге JSON в строке ${bIndex + 1}: ${e.message}`);
      }
    });

    // 5. Обновляем данные провинций в исходном диапазоне
    provincesData.forEach((row, pIndex) => {
      const cell = row[0];
      if (!cell) return;
      try {
        let jsonString = cell;
        if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
          jsonString = jsonString.slice(1, -1);
        }
        jsonString = jsonString.replace(/""/g, '"');
        const province = JSON.parse(jsonString);
        if (province && province.id && provinceMap[province.id]) {
          row[0] = JSON.stringify(provinceMap[province.id]);
        }
      } catch (e) {
        messages.push(`[Ошибка][processArableLandSimple] Ошибка при обновлении данных провинции в строке ${pIndex + 1}: ${e.message}`);
      }
    });
  } catch (error) {
    messages.push(`[Ошибка][processArableLandSimple] Общая ошибка: ${error.message}`);
  }
  return messages;
}
