/**
 * Функция для обновления состояния в шаблонах построек на основе критериев state_required_buildings
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Spreadsheet} spreadsheet - Объект активной таблицы
 * @returns {Array} newMessages - Массив новых сообщений для журнала
 */
function updateStateRequiredBuildings(data, spreadsheet) {
  let newMessages = [];

  try {
    // 1. Получение state_name из Переменные_Основные
    const variablesData = data['Переменные_Основные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      newMessages.push(`[Ошибка] Переменные_Основные пуст или не содержит данных.`);
      return newMessages;
    }

    let stateName;
    try {
      const rawData = variablesData[0][0];
      // Убедимся, что rawData является строкой и содержит JSON
      if (typeof rawData !== 'string') {
        newMessages.push(`[Ошибка] Содержимое первой ячейки Переменные_Основные не является строкой.`);
        return newMessages;
      }

      const jsonString = rawData.trim();
      if (!jsonString.startsWith('{') || !jsonString.endsWith('}')) {
        newMessages.push(`[Ошибка] Содержимое первой ячейки Переменные_Основные не является JSON-строкой.`);
        return newMessages;
      }

      const variablesJson = JSON.parse(jsonString);
      stateName = variablesJson.state_name;
      if (!stateName) {
        newMessages.push(`[Ошибка] Ключ "state_name" не найден в Переменные_Основные.`);
        return newMessages;
      }
    } catch (e) {
      newMessages.push(`[Ошибка] Ошибка при парсинге JSON из Переменные_Основные: ${e.message}`);
      return newMessages;
    }

    // 2. Получение списка провинций
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      newMessages.push(`[Ошибка] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }

    // Парсинг провинций и группировка по владельцам
    const provinceMap = {}; // id -> owner
    const stateProvinces = []; // Провинции нашего государства
    const otherProvinces = []; // Провинции других государств

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
            newMessages.push(`[Предупреждение] Провинция в строке ${index + 1} не содержит ключа "id" или "owner".`);
          }
        } catch (e) {
          newMessages.push(`[Ошибка] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    // 3. Получение списка построек
    const buildingsData = data['Постройки_ОсновнаяИнформация'];
    if (!buildingsData || buildingsData.length === 0) {
      newMessages.push(`[Ошибка] Постройки_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }

    // Подсчет построек по типам во всех провинциях нашего государства
    const buildingCounts = {}; // building_name -> total count

    buildingsData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const building = JSON.parse(cell);
          const buildingName = building.building_name;
          const provinceId = building.province_id;

          if (buildingName && provinceId && provinceMap[provinceId] === stateName) {
            if (!buildingCounts[buildingName]) {
              buildingCounts[buildingName] = 0;
            }
            buildingCounts[buildingName] += 1;
          } else {
            newMessages.push(`[Предупреждение] Постройка не содержит ключи "building_name" или "province_id", или принадлежит другой империи.`);
          }
        } catch (e) {
          newMessages.push(`[Ошибка] Ошибка при парсинге JSON из Постройки_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    // 4. Получение списка шаблонов построек
    const templatesData = data['Постройки_Шаблоны'];
    if (!templatesData || templatesData.length === 0) {
      newMessages.push(`[Ошибка] Постройки_Шаблоны пуст или не содержит данных.`);
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
            newMessages.push(`[Предупреждение] Шаблон в строке ${index + 1} не содержит ключа "name".`);
            return;
          }
          if (!template.state_required_buildings) {
            newMessages.push(`[Предупреждение] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "state_required_buildings".`);
            return;
          }
          if (!template.matching_provinces_state) {
            newMessages.push(`[Предупреждение] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "matching_provinces_state".`);
            return;
          }
          if (!template.matching_provinces_others) {
            newMessages.push(`[Предупреждение] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "matching_provinces_others".`);
            return;
          }
          templates.push({ data: template, row: index });
        } catch (e) {
          newMessages.push(`[Ошибка] Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    if (templates.length === 0) {
      newMessages.push(`[Ошибка] Нет корректных шаблонов в Постройки_Шаблоны для обработки.`);
      return newMessages;
    }

    // 5. Обработка каждого шаблона
    templates.forEach(templateInfo => {
      const template = templateInfo.data;
      const templateName = template.name;
      const stateCriteria = template.state_required_buildings;

      if (typeof stateCriteria !== 'object' || stateCriteria === null) {
        newMessages.push(`[Предупреждение] Шаблон "${templateName}" имеет некорректные критерии в "state_required_buildings".`);
        return;
      }

      const isMatching = evaluateStateCriteria(stateCriteria, buildingCounts);

      if (isMatching) {
        // Критерии выполнены
        newMessages.push(`Шаблон "${templateName}" соответствует критериям "state_required_buildings".`);
        // Дополнительные действия при необходимости
      } else {
        // Критерии не выполнены
        newMessages.push(`Шаблон "${templateName}" не соответствует критериям "state_required_buildings".`);

        // Очистка списков matching_provinces_state и matching_provinces_others
        if (template.matching_provinces_state && template.matching_provinces_state.length > 0) {
          const removedProvinces = template.matching_provinces_state.join(', ');
          template.matching_provinces_state = [];
          newMessages.push(`В шаблоне "${templateName}" были удалены провинции из "matching_provinces_state": ${removedProvinces}.`);
        }

        if (template.matching_provinces_others && template.matching_provinces_others.length > 0) {
          const removedProvinces = template.matching_provinces_others.join(', ');
          template.matching_provinces_others = [];
          newMessages.push(`В шаблоне "${templateName}" были удалены провинции из "matching_provinces_others": ${removedProvinces}.`);
        }

        // Обновление шаблона в data
        data['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
      }
    });

  } catch (error) {
    newMessages.push(`[Ошибка] updateStateRequiredBuildings: ${error.message}`);
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
  if (typeof criteria !== 'object' || criteria === null) return false;

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
        const [first, second] = value;
        const firstExists = (buildingCounts[first] || 0) > 0;
        const secondExists = (buildingCounts[second] || 0) > 0;
        return firstExists === secondExists;

      case 'IMPLIES':
        if (!Array.isArray(value) || value.length !== 2) return false;
        const [antecedent, consequent] = value;
        const antecedentExists = (buildingCounts[antecedent] || 0) > 0;
        const consequentExists = (buildingCounts[consequent] || 0) > 0;
        return !antecedentExists || consequentExists;

      default:
        // Если оператор неизвестен, возвращаем false
        return false;
    }
  }

  // Если критерий не содержит известных операторов
  return false;
}

