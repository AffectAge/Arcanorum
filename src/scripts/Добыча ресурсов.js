/**
 * Функция для обработки добычи ресурсов зданиями.
 * Выполняет следующие шаги:
 * 1. Находит все здания, принадлежащие нашему государству и со статусом "Активная".
 * 2. Для каждого такого здания ищет шаблон в "Постройки_Шаблоны" по совпадению building_name с name шаблона.
 *    Если в шаблоне есть ключ resource_extraction, копирует его в здание с расчетом current_quantity:
 *       current_quantity = (quantity из шаблона * building_level) * extraction_efficiency (из building_modifiers)
 * 3. Для каждого ресурса из resource_extraction здания ищется провинция (по province_id) и обновляются её запасы:
 *    – Если в провинции хватает ресурса, вычитается необходимое количество, а здание получает их на склад.
 *    – Если в провинции ресурсов меньше, добывается доступное количество, и выводится сообщение об истощении.
 *    – Если после добычи ресурс в провинции оказывается меньше заданного порога (например, меньше 3 циклов добычи),
 *      выводится сообщение с числом оставшихся ходов (округленным вверх).
 *    – Если ресурс отсутствует в провинции – выводится сообщение, и здание деактивируется.
 *    – Если ресурс полностью исчерпан (quantity равен 0), то удаляется из массива province.resources.
 *
 * В настройках (именованный диапазон "Настройки") можно указать порог циклов для сообщений об истощении,
 * идентификатор строки: "Настройки добычи ресурсов" с JSON-полем resource_extraction_exhaustion_message.
 *
 * @param {Object} data - Объект с данными из именованных диапазонов.
 * @returns {Array} messages - Массив сообщений для журнала событий.
 */
function processResourceExtraction(data) {
  let messages = [];
  try {
    // 0. Извлекаем stateName из Переменные
    let stateName;
    {
      const targetIdentifier = 'Основные данные государства';
      const targetRow = data['Переменные']?.find(row => row[0] === targetIdentifier);
      if (targetRow && targetRow[1]) {
        const jsonMatch = targetRow[1].match(/\{.*\}/);
        if (jsonMatch) {
          const variablesJson = JSON.parse(jsonMatch[0]);
          stateName = variablesJson.state_name;
          if (!stateName) {
            messages.push(`[Ошибка] Ключ "state_name" не найден в Переменные.`);
            return messages;
          }
        } else {
          messages.push(`[Ошибка] Не удалось извлечь JSON из строки "${targetIdentifier}" в Переменные.`);
          return messages;
        }
      } else {
        messages.push(`[Ошибка] Идентификатор "${targetIdentifier}" не найден в Переменные.`);
        return messages;
      }
    }
    
    // 1. Извлекаем порог циклов для сообщений из Настроек (по умолчанию 3)
    let extractionThreshold = 3;
    if (data['Настройки'] && data['Настройки'].length > 0) {
      const settingsRow = data['Настройки'].find(row => row[0] === "Настройки добычи ресурсов");
      if (settingsRow && settingsRow[1]) {
        try {
          const settingsJson = JSON.parse(settingsRow[1]);
          if (settingsJson.resource_extraction_exhaustion_message) {
            extractionThreshold = settingsJson.resource_extraction_exhaustion_message;
          }
        } catch(e) {
          messages.push(`[Предупреждение] Ошибка парсинга настроек добычи ресурсов: ${e.message}. Используем значение по умолчанию (${extractionThreshold}).`);
        }
      }
    }
    
    // 2. Собираем провинции: создаём карту provinceMap и индексную карту для обновления исходных данных
    const provinceMap = {};
    const provinceIndexMap = {}; // province id -> индекс строки в data['Провинции_ОсновнаяИнформация']
    const provincesData = data['Провинции_ОсновнаяИнформация'] || [];
    provincesData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (cell && cell.trim() !== "") {
        try {
          const provinceObj = JSON.parse(cell);
          provinceMap[provinceObj.id] = provinceObj;
          provinceIndexMap[provinceObj.id] = rowIndex;
        } catch(e) {
          messages.push(`[Ошибка] Парсинг провинции в строке ${rowIndex+1}: ${e.message}`);
        }
      }
    });
    
    // 3. Собираем шаблоны зданий и создаём карту по имени шаблона
    const templateMap = {};
    const templatesData = data['Постройки_Шаблоны'] || [];
    templatesData.forEach((row, index) => {
      const cell = row[0];
      if (cell && cell.trim() !== "") {
        try {
          const templateObj = JSON.parse(cell);
          if (templateObj.name) {
            templateMap[templateObj.name] = templateObj;
          } else {
            messages.push(`[Ошибка] Шаблон в строке ${index+1} не содержит "name".`);
          }
        } catch(e) {
          messages.push(`[Ошибка] Парсинг шаблона в строке ${index+1}: ${e.message}`);
        }
      }
    });
    
    // 4. Обрабатываем здания из "Постройки_ОсновнаяИнформация"
    const buildingsData = data['Постройки_ОсновнаяИнформация'] || [];
    buildingsData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (!cell || cell.trim() === "") return;
      try {
        let buildingsArray = JSON.parse(cell);
        let updatedBuildings = false;
        // Перебор каждого здания в строке
        buildingsArray.forEach(building => {
          // Обрабатываем только здания нашего государства и со статусом "Активная"
          if (building.building_owner !== stateName || building.status !== "Активная") return;
          
          // 4.1 Поиск шаблона по совпадению building_name
          const template = templateMap[building.building_name];
          if (!template) {
            messages.push(`[Предупреждение] Шаблон для здания "${building.building_name}" не найден.`);
            return;
          }
          
          // Если у шаблона нет ключа resource_extraction – пропускаем здание
          if (!template.resource_extraction || !Array.isArray(template.resource_extraction)) return;
          
          // 4.2 Копируем массив resource_extraction из шаблона с вычислением current_quantity
          const newResourceExtraction = [];
          template.resource_extraction.forEach(item => {
            if (typeof item.quantity !== 'number') return;
            const baseQuantity = item.quantity;
            const level = building.building_level || 1;
            let extractionEfficiency = 1;
            if (building.building_modifiers && typeof building.building_modifiers.extraction_efficiency === 'number') {
              extractionEfficiency = building.building_modifiers.extraction_efficiency;
            }
            const currentQuantity = (baseQuantity * level) * extractionEfficiency;
            newResourceExtraction.push({
              resource: item.resource,
              quantity: baseQuantity,
              current_quantity: currentQuantity
            });
          });
          if (newResourceExtraction.length === 0) return;
          // Обновляем ключ resource_extraction здания
          building.resource_extraction = newResourceExtraction;
          
          // 4.3 По province_id находим соответствующую провинцию
          if (!building.province_id) {
            messages.push(`[Ошибка] Здание "${building.building_name}" не содержит province_id.`);
            return;
          }
          const province = provinceMap[building.province_id];
          if (!province) {
            messages.push(`[Ошибка] Провинция с id "${building.province_id}" не найдена для здания "${building.building_name}".`);
            return;
          }
          
          // 4.4 Обрабатываем каждый ресурс из resource_extraction здания
          newResourceExtraction.forEach(item => {
            const resourceName = item.resource;
            const extractionAmount = item.current_quantity;
            // Проверяем, есть ли ресурс в провинции
            if (!province.resources || !Array.isArray(province.resources)) {
              messages.push(`[Ошибка] Провинция "${province.id}" не содержит ресурсы для здания "${building.building_name}".`);
              return;
            }
            const resourceIndex = province.resources.findIndex(r => r.resource === resourceName);
            if (resourceIndex === -1) {
              // Ресурса нет – выводим сообщение и деактивируем здание
              messages.push(`[Событие] В провинции "${province.id}" отсутствуют запасы ресурса "${resourceName}" для здания "${building.building_name}". Здание деактивировано.`);
              building.status = "Неактивная";
              return;
            }
            const provinceResource = province.resources[resourceIndex];
            if (provinceResource.quantity <= 0) {
              messages.push(`[Событие] Ресурс "${resourceName}" в провинции "${province.id}" полностью исчерпан для здания "${building.building_name}". Здание деактивировано.`);
              building.status = "Неактивная";
              return;
            }
            // Если провинция содержит меньше ресурсов, чем нужно, добываем доступное количество
            let availableExtraction = extractionAmount;
            if (provinceResource.quantity < extractionAmount) {
              availableExtraction = provinceResource.quantity;
              messages.push(`[Событие] Недостаточно ресурса "${resourceName}" в провинции "${province.id}" для здания "${building.building_name}". Извлечено только ${availableExtraction} единиц.`);
            }
            // Вычитаем добытое количество из провинции
            provinceResource.quantity -= availableExtraction;
            // Если ресурс полностью исчерпан, удаляем его из провинции и выводим сообщение
            if (provinceResource.quantity <= 0) {
              messages.push(`[Событие] Запасы ресурса "${resourceName}" в провинции "${province.id}" исчерпаны.`);
              province.resources.splice(resourceIndex, 1);
            } else {
              // Если оставшиеся запасы меньше, чем заданное число циклов добычи, выводим сообщение
              const cyclesRemaining = Math.ceil(provinceResource.quantity / extractionAmount);
              if (cyclesRemaining < extractionThreshold) {
                messages.push(`[Событие] Здание "${building.building_name}" в провинции "${province.id}": запасы ресурса "${resourceName}" исчерпаются через ${cyclesRemaining} ход(а/ов).`);
              }
            }
            // Обновляем склад здания: прибавляем добытое количество
            if (!building.warehouse) {
              building.warehouse = {};
            }
            if (building.warehouse[resourceName]) {
              building.warehouse[resourceName].current_quantity += availableExtraction;
            } else {
              // Если ресурса нет на складе, добавляем его с резервом 0 (можно задать другое значение по необходимости)
              building.warehouse[resourceName] = { current_quantity: availableExtraction, reserve_level: 0 };
            }
          });
          updatedBuildings = true;
        });
        // Если в данной строке были изменения – обновляем строку
        if (updatedBuildings) {
          buildingsData[rowIndex][0] = JSON.stringify(buildingsArray);
        }
      } catch (e) {
        messages.push(`[Ошибка] Обработка зданий в строке ${rowIndex+1}: ${e.message}`);
      }
    });
    
    // 5. Обновляем данные по провинциям в исходном массиве, используя provinceIndexMap
    Object.keys(provinceMap).forEach(provinceId => {
      const province = provinceMap[provinceId];
      const index = provinceIndexMap[provinceId];
      if (index !== undefined) {
        provincesData[index][0] = JSON.stringify(province);
      }
    });
    
  } catch (error) {
    messages.push(`[Ошибка] processResourceExtraction: ${error.message}`);
  }
  return messages;
}
