/**
 * Функция для обновления состояния в шаблонах построек на основе критериев state_required_buildings
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Spreadsheet} spreadsheet - Объект активной таблицы
 * @returns {Array} newMessages - Массив новых сообщений для журнала
 */
function updateStateRequiredBuildings(data, spreadsheet) {
  let newMessages = [];

  try {
    // 1. Получение state_name из Переменные
    const variablesData = data['Переменные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      newMessages.push(`[Ошибка][updateStateRequiredBuildings] Переменные пуст или не содержит данных.`);
      return newMessages;
    }

    // 1. Получение state_name из Переменные
let stateName;
try {
  const targetIdentifier = 'Основные данные государства';
  
  // Ищем строку с нужным идентификатором
  const targetRow = data['Переменные'].find(row => row[0] === targetIdentifier);
  
  if (targetRow && targetRow[1]) {
    // Извлекаем JSON из второго столбца
    const jsonMatch = targetRow[1].match(/\{.*\}/);
    if (jsonMatch) {
      const variablesJson = JSON.parse(jsonMatch[0]);
      stateName = variablesJson.state_name;
      
      if (!stateName) {
        newMessages.push(`[Ошибка][updateStateRequiredBuildings] Ключ "state_name" не найден в Переменные.`);
        return newMessages;
      }
    } else {
      throw new Error('Не удалось извлечь JSON из содержимого Переменные.');
    }
  } else {
    throw new Error(`Идентификатор "${targetIdentifier}" не найден в Переменные.`);
  }
} catch (e) {
  newMessages.push(`[Ошибка][updateStateRequiredBuildings] Ошибка при парсинге JSON из Переменные: ${e.message}`);
  return newMessages;
}
    // 2. Получение списка провинций
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      newMessages.push(`[Ошибка][updateStateRequiredBuildings] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }

    // Парсинг провинций и группировка по владельцам
    const provinceMap = {}; // id -> owner
    const stateProvinces = []; // Провинции нашего государства

    provincesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const province = JSON.parse(cell);
          if (province.id && province.owner) {
            provinceMap[province.id] = province.owner;
            if (province.owner === stateName) {
              stateProvinces.push(province.id);
            }
          } else {
            newMessages.push(`[Ошибка][updateStateRequiredBuildings] Провинция в строке ${index + 1} не содержит ключа "id" или "owner".`);
          }
        } catch (e) {
          newMessages.push(`[Ошибка][updateStateRequiredBuildings] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    // 3. Получение списка построек
    const buildingsData = data['Постройки_ОсновнаяИнформация'];
    if (!buildingsData || buildingsData.length === 0) {
      newMessages.push(`[Ошибка][updateStateRequiredBuildings] Постройки_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }

    // Подсчет построек по типам во всех провинциях нашего государства
    const buildingCounts = {}; // building_name -> total count

    buildingsData.forEach((row, index) => {
      const cell = row[0];
      if (!cell) return;

      try {
        const parsedData = JSON.parse(cell);

        // <-- Новое/Изменённое: поддержка массива зданий или одиночного объекта
        const buildingsArray = Array.isArray(parsedData) ? parsedData : [parsedData];

        buildingsArray.forEach((building, idx) => {
          const buildingName = building.building_name;
          const provinceId = building.province_id;

          if (!buildingName || !provinceId) {
            newMessages.push(`[Ошибка][updateStateRequiredBuildings] Постройка (строка ${index + 1}, элемент массива ${idx + 1}) не содержит ключи "building_name" или "province_id".`);
            return;
          }

          // Если провинция принадлежит нашему государству
          if (provinceMap[provinceId] === stateName) {
            if (!buildingCounts[buildingName]) {
              buildingCounts[buildingName] = 0;
            }
            buildingCounts[buildingName] += 1;
          }
        });
      } catch (e) {
        newMessages.push(`[Ошибка][updateStateRequiredBuildings] Ошибка при парсинге JSON из Постройки_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
      }
    });

    // 4. Получение списка шаблонов построек
    const templatesData = data['Постройки_Шаблоны'];
    if (!templatesData || templatesData.length === 0) {
      newMessages.push(`[Ошибка][updateStateRequiredBuildings] Постройки_Шаблоны пуст или не содержит данных.`);
      return newMessages;
    }

    // Парсинг шаблонов
    const templates = []; // { data: templateObject, row: rowIndex }
    templatesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const template = JSON.parse(cell);
          if (!template.name) {
            newMessages.push(`[Ошибка][updateStateRequiredBuildings] Шаблон в строке ${index + 1} не содержит ключа "name".`);
            return;
          }
          if (!template.state_required_buildings) {
            newMessages.push(`[Ошибка][updateStateRequiredBuildings] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "state_required_buildings".`);
            return;
          }
          if (!template.matching_provinces_state) {
            newMessages.push(`[Ошибка][updateStateRequiredBuildings] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "matching_provinces_state".`);
            return;
          }
          if (!template.matching_provinces_others) {
            newMessages.push(`[Ошибка][updateStateRequiredBuildings] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "matching_provinces_others".`);
            return;
          }
          templates.push({ data: template, row: index });
        } catch (e) {
          newMessages.push(`[Ошибка][updateStateRequiredBuildings] Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    if (templates.length === 0) {
      newMessages.push(`[Ошибка][updateStateRequiredBuildings] Нет корректных шаблонов в Постройки_Шаблоны для обработки.`);
      return newMessages;
    }

    // 5. Обработка каждого шаблона
    templates.forEach(templateInfo => {
      const template = templateInfo.data;
      const templateName = template.name;
      const stateCriteria = template.state_required_buildings;

      // <-- Дополнительная проверка: если state_required_buildings — это пустой объект, критерий считается выполненным
      // (В evaluateStateCriteria теперь тоже есть проверка, но можно дублировать для наглядности)
      if (
        typeof stateCriteria === 'object' &&
        stateCriteria !== null &&
        Object.keys(stateCriteria).length === 0
      ) {
        newMessages.push(`[Постройки][Необходимые постройки в государстве]Постройка "${templateName}" критерии state_required_buildings пусты — автоматически выполнено.`);
        return;
      }

      const isMatching = evaluateStateCriteria(stateCriteria, buildingCounts);

      if (isMatching) {
        // Критерии выполнены
        newMessages.push(`[Постройки][Необходимые постройки в государстве]Постройка "${templateName}" соответствует критериям наличия других построек в государстве.`);
        // Дополнительные действия при необходимости
      } else {
        // Критерии не выполнены
        newMessages.push(`[Постройки][Необходимые постройки в государстве]Шаблон "${templateName}" не соответствует критериям наличия других построек в государстве.`);

        // Очистка списков matching_provinces_state и matching_provinces_others
        if (template.matching_provinces_state && template.matching_provinces_state.length > 0) {
          const removedProvinces = template.matching_provinces_state.join(', ');
          template.matching_provinces_state = [];
          newMessages.push(`[Постройки][Необходимые постройки в государстве]Постройка "${templateName}" больше не соответствует критериям (очистка провинций нашей страны): ${removedProvinces}.`);
        }

        if (template.matching_provinces_others && template.matching_provinces_others.length > 0) {
          const removedProvinces = template.matching_provinces_others.join(', ');
          template.matching_provinces_others = [];
          newMessages.push(`[Постройки][Необходимые постройки в государстве]Постройка "${templateName}" больше не соответствует критериям (очистка провинций других стран): ${removedProvinces}.`);
        }

        // Обновление шаблона в data
        data['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
      }
    });

  } catch (error) {
    newMessages.push(`[Ошибка][updateStateRequiredBuildings] updateStateRequiredBuildings: ${error.message}`);
  }

  return newMessages;
}

/**
 * Функция для оценки соответствия состояния государства критериям
 * @param {Object} criteria - Критерии из state_required_buildings
 * @param {Object} buildingCounts - Объект с общим количеством построек по типам во всех провинциях государства
 * @returns {Boolean} - Возвращает true, если критерии выполнены, иначе false
 */
function evaluateStateCriteria(criteria, buildingCounts) {
  if (typeof criteria !== 'object' || criteria === null) {
    return false;
  }

  // <-- Новое/Изменённое: если объект пустой, сразу возвращаем true
  if (Object.keys(criteria).length === 0) {
    return true;
  }

  for (const operator in criteria) {
    if (!criteria.hasOwnProperty(operator)) continue;

    const value = criteria[operator];

    switch (operator) {
      case 'AND':
        if (!Array.isArray(value)) return false;
        return value.every(subCriteria => evaluateStateCriteria(subCriteria, buildingCounts));

      case 'OR':
        if (!Array.isArray(value)) return false;
        return value.some(subCriteria => evaluateStateCriteria(subCriteria, buildingCounts));

      case 'NOT':
        if (!Array.isArray(value)) return false;
        return !value.some(subCriteria => evaluateStateCriteria(subCriteria, buildingCounts));

      case 'MIN_COUNT':
        if (typeof value !== 'object') return false;
        for (const building in value) {
          if (!value.hasOwnProperty(building)) continue;
          const minCount = value[building];
          if ((buildingCounts[building] || 0) < minCount) return false;
        }
        return true;

      case 'MAX_COUNT':
        if (typeof value !== 'object') return false;
        for (const building in value) {
          if (!value.hasOwnProperty(building)) continue;
          const maxCount = value[building];
          if ((buildingCounts[building] || 0) > maxCount) return false;
        }
        return true;

      case 'XNOR':
        if (!Array.isArray(value) || value.length !== 2) return false;
        {
          const [first, second] = value;
          const firstExists = (buildingCounts[first] || 0) > 0;
          const secondExists = (buildingCounts[second] || 0) > 0;
          return firstExists === secondExists;
        }

      case 'IMPLIES':
        if (!Array.isArray(value) || value.length !== 2) return false;
        {
          const [antecedent, consequent] = value;
          const antecedentExists = (buildingCounts[antecedent] || 0) > 0;
          const consequentExists = (buildingCounts[consequent] || 0) > 0;
          return !antecedentExists || consequentExists;
        }

      default:
        // Если оператор неизвестен, возвращаем false
        return false;
    }
  }

  // Если критерий не содержит ни одного известного оператора
  return false;
}
