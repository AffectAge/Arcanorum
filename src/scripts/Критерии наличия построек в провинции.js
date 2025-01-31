/**
 * Функция для обновления списков matching_provinces_state и matching_provinces_others в шаблонах построек
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Spreadsheet} spreadsheet - Объект активной таблицы
 * @returns {Array} newMessages - Массив новых сообщений для журнала
 */
function updateProvinceRequiredBuildings(data, spreadsheet) {
  let newMessages = [];

  try {
    // 1. Получение state_name из первой строки Переменные_ОсновнаяИнформация
    const variablesData = data['Переменные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Переменные_ОсновнаяИнформация пуст или не содержит данных.`);
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
        newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Ключ "state_name" не найден в Переменные.`);
        return newMessages;
      }
    } else {
      throw new Error('Не удалось извлечь JSON из содержимого Переменные.');
    }
  } else {
    throw new Error(`Идентификатор "${targetIdentifier}" не найден в Переменные.`);
  }
} catch (e) {
  newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Ошибка при парсинге JSON из Переменные: ${e.message}`);
  return newMessages;
}

    // 2. Получение списка провинций
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }

    // Парсинг провинций и группировка по владельцам
    const provinceMap = {}; // id -> province
    const stateProvinces = []; // Провинции нашего государства
    const otherProvinces = []; // Провинции других государств

    provincesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const province = JSON.parse(cell);
          if (province.id) {
            provinceMap[province.id] = province;
            if (province.owner === stateName) {
              stateProvinces.push(province.id);
            } else {
              otherProvinces.push(province.id);
            }
          } else {
            newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Провинция в строке ${index + 1} не содержит ключа "id".`);
          }
        } catch (e) {
          newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    // 3. Получение списка построек
    const buildingsData = data['Постройки_ОсновнаяИнформация'];
    if (!buildingsData || buildingsData.length === 0) {
      newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Постройки_ОсновнаяИнформация пуст или не содержит данных.`);
      return newMessages;
    }

    // Подсчет построек по типам и провинциям
    // Структура: { province_id: { building_name: count } }
    const buildingCountsByProvince = {};

    buildingsData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const parsedData = JSON.parse(cell);

          // **Изменение: Поддержка нескольких зданий в одной ячейке**
          const buildingsArray = Array.isArray(parsedData) ? parsedData : [parsedData];

          buildingsArray.forEach((building, bIndex) => {
            const buildingName = building.building_name;
            const provinceId = building.province_id;

            if (!buildingName || !provinceId) {
              newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Здание в строке ${index + 1}, элемент ${bIndex + 1} не содержит ключи "building_name" или "province_id".`);
              return;
            }

            if (!buildingCountsByProvince[provinceId]) {
              buildingCountsByProvince[provinceId] = {};
            }

            if (!buildingCountsByProvince[provinceId][buildingName]) {
              buildingCountsByProvince[provinceId][buildingName] = 0;
            }

            buildingCountsByProvince[provinceId][buildingName] += 1;
          });
          // **Конец изменения**
        } catch (e) {
          newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Ошибка при парсинге JSON из Постройки_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    // 4. Получение списка шаблонов построек
    const templatesData = data['Постройки_Шаблоны'];
    if (!templatesData || templatesData.length === 0) {
      newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Постройки_Шаблоны пуст или не содержит данных.`);
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
            newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Шаблон в строке ${index + 1} не содержит ключа "name".`);
            return;
          }
          if (!template.province_required_buildings) {
            newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "province_required_buildings".`);
            return;
          }
          if (!template.matching_provinces_state) {
            newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "matching_provinces_state".`);
            return;
          }
          if (!template.matching_provinces_others) {
            newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "matching_provinces_others".`);
            return;
          }
          templates.push({ data: template, row: index });
        } catch (e) {
          newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    if (templates.length === 0) {
      newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Нет корректных шаблонов в Постройки_Шаблоны для обработки.`);
      return newMessages;
    }

    // 5. Обработка каждого шаблона
    templates.forEach(templateInfo => {
      const template = templateInfo.data;
      const templateName = template.name;
      const provinceCriteria = template.province_required_buildings;

      if (typeof provinceCriteria !== 'object' || provinceCriteria === null) {
        newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Шаблон "${templateName}" имеет некорректные критерии в "province_required_buildings".`);
        return;
      }

      // Найти все провинции, которые соответствуют критериям
      const matchingProvincesState = [];
      const matchingProvincesOthers = [];

      // Проверка провинций нашего государства
      stateProvinces.forEach(provinceId => {
        const buildingCounts = buildingCountsByProvince[provinceId] || {};
        if (evaluateCriteria(provinceCriteria, buildingCounts)) {
          matchingProvincesState.push(provinceId);
        }
      });

      // Проверка провинций других государств
      otherProvinces.forEach(provinceId => {
        const buildingCounts = buildingCountsByProvince[provinceId] || {};
        if (evaluateCriteria(provinceCriteria, buildingCounts)) {
          matchingProvincesOthers.push(provinceId);
        }
      });

      // Получение текущих списков
      const currentMatchingState = template.matching_provinces_state || [];
      const currentMatchingOthers = template.matching_provinces_others || [];

      // Определение провинций, которые нужно удалить из matching_provinces_state
      const provincesToRemoveState = currentMatchingState.filter(id => !matchingProvincesState.includes(id));
      if (provincesToRemoveState.length > 0) {
        template.matching_provinces_state = currentMatchingState.filter(id => matchingProvincesState.includes(id));
        const provinceNames = provincesToRemoveState.join(', '); // Отображаем ID вместо имен

        newMessages.push(`[Постройки][Необходимые постройки в провинции] Наши провинции: ${provinceNames} больше не подходят для постройки "${templateName}" так как не соблюдаются критерии соседства построек.`);
      }

      // Определение провинций, которые нужно удалить из matching_provinces_others
      const provincesToRemoveOthers = currentMatchingOthers.filter(id => !matchingProvincesOthers.includes(id));
      if (provincesToRemoveOthers.length > 0) {
        template.matching_provinces_others = currentMatchingOthers.filter(id => matchingProvincesOthers.includes(id));
        const provinceNames = provincesToRemoveOthers.join(', '); // Отображаем ID вместо имен

        newMessages.push(`[Постройки][Необходимые постройки в провинции] Провинции других государств: ${provinceNames} больше не подходят для постройки "${templateName}" так как не соблюдаются критерии соседства построек.`);
      }

      // Обновление шаблона в data
      try {
        data['Постройки_Шаблоны'][templateInfo.row][0] = JSON.stringify(template);
      } catch (e) {
        newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] Ошибка при сериализации JSON для шаблона "${templateName}" в строке ${templateInfo.row + 1}: ${e.message}`);
      }
    });

  } catch (error) {
    newMessages.push(`[Ошибка][updateProvinceRequiredBuildings] updateMatchingProvinces: ${error.message}`);
  }

  return newMessages;
}

/**
 * Функция для оценки соответствия провинции критериям
 * @param {Object} criteria - Критерии из province_required_buildings
 * @param {Object} buildingCounts - Объект с количеством построек по типам в провинции
 * @returns {Boolean} - Возвращает true, если провинция соответствует критериям или критерии отсутствуют, иначе false
 */
function evaluateCriteria(criteria, buildingCounts) {
  // **Изменение: Если критерии отсутствуют или пусты, считаем их выполненными**
  if (typeof criteria !== 'object' || criteria === null || Object.keys(criteria).length === 0) {
    return true;
  }

  for (const operator in criteria) {
    if (!criteria.hasOwnProperty(operator)) continue;

    const value = criteria[operator];

    switch (operator) {
      case 'AND':
        if (!Array.isArray(value)) return false;
        return value.every(subCriteria => evaluateCriteria(subCriteria, buildingCounts));

      case 'OR':
        if (!Array.isArray(value)) return false;
        return value.some(subCriteria => evaluateCriteria(subCriteria, buildingCounts));

      case 'NOT':
        if (!Array.isArray(value)) return false;
        return !value.some(subCriteria => evaluateCriteria(subCriteria, buildingCounts));

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

  // Если критерий не содержит известных операторов, возвращаем true
  return true;
}
