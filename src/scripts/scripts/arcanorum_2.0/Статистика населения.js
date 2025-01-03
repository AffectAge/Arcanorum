/**
 * Функция для агрегации данных о населении для собственных и чужих провинций
 * и записи результатов в Переменные_Основные
 * @param {Object} data - Объект с данными из именованных диапазонов
 * @param {Sheet} sheet - Активный лист
 * @param {Spreadsheet} spreadsheet - Активная таблица
 * @returns {Array} messages - Массив сообщений об ошибках и предупреждениях
 */
function aggregatePopulationDataWithInterestGroupDetails(data, sheet, spreadsheet) {
  const messages = [];

  try {
    // Извлечение state_name из Переменные_Основные
    const stateVariables = data['Переменные_Основные'];
    if (!stateVariables || stateVariables.length === 0 || !stateVariables[0][0]) {
      messages.push('[Ошибка] Именной диапазон "Переменные_Основные" пуст или не содержит данных.');
      return messages;
    }

    let stateName;
    try {
      const stateData = JSON.parse(stateVariables[0][0]);
      if (stateData.state_name && typeof stateData.state_name === 'string') {
        stateName = stateData.state_name;
        messages.push(`[Отладка] state_name: ${stateName}`);
      } else {
        messages.push('[Ошибка] В "Переменные_Основные" отсутствует ключ "state_name" или он не является строкой.');
        return messages;
      }
    } catch (e) {
      messages.push(`[Ошибка] Парсинг JSON в "Переменные_Основные": ${e.message}`);
      return messages;
    }

    // Извлечение провинций из Провинции_ОсновнаяИнформация
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      messages.push('[Ошибка] Именной диапазон "Провинции_ОсновнаяИнформация" пуст или не содержит данных.');
      return messages;
    }

    const ownProvinces = [];
    const otherProvinces = [];

    provincesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const province = JSON.parse(cell);
          if (province.id && province.owner) {
            if (typeof province.id !== 'string' || typeof province.owner !== 'string') {
              messages.push(`[Предупреждение] Провинция в строке ${index + 1} имеет некорректные типы данных для "id" или "owner".`);
              return;
            }
            if (province.owner === stateName) {
              ownProvinces.push(province.id);
            } else {
              otherProvinces.push(province.id);
            }
          } else {
            messages.push(`[Предупреждение] Провинция в строке ${index + 1} не содержит ключи "id" или "owner".`);
          }
        } catch (e) {
          messages.push(`[Ошибка] Парсинг JSON провинции в строке ${index + 1}: ${e.message}`);
        }
      } else {
        messages.push(`[Предупреждение] Провинция в строке ${index + 1} пуста.`);
      }
    });

    // Логирование содержимого ownProvinces и otherProvinces
    messages.push(`[Отладка] Собственные провинции: ${ownProvinces.join(', ') || 'Нет'}`);
    messages.push(`[Отладка] Чужие провинции: ${otherProvinces.join(', ') || 'Нет'}`);

    if (ownProvinces.length === 0) {
      messages.push('[Информация] Нет провинций, принадлежащих вашему государству.');
    }

    if (otherProvinces.length === 0) {
      messages.push('[Информация] Нет провинций, принадлежащих другим государствам.');
    }

    // Извлечение данных о населении из Население_ОсновнаяИнформация
    const populationData = data['Население_ОсновнаяИнформация'];
    if (!populationData || populationData.length === 0) {
      messages.push('[Ошибка] Именной диапазон "Население_ОсновнаяИнформация" пуст или не содержит данных.');
      return messages;
    }

    // Инициализация агрегированных данных для собственных и чужих провинций
    const aggregatedOwn = initializeAggregatedData();
    const aggregatedOther = initializeAggregatedData();

    function initializeAggregatedData() {
      return {
        professions: {},
        interest_groups: {},
        political: {
          radicals: 0,
          loyalists: 0,
          neutrals: 0
        },
        migration: {
          incoming: 0,
          outgoing: 0
        },
        wealth: {
          money: 0
        },
        employment: {
          total_workers: 0,
          employed_workers: 0,
          unemployed_workers: 0
        },
        gender: {
          male: 0,
          female: 0
        },
        culture: {},
        religion: {},
        total_population: 0
      };
    }

    // Функция для агрегации данных
    function aggregateData(pop, aggregation, rowIndex, provinceType) {
      const demographics = pop.demographics || {};
      const employment = pop.employment || {};
      const wealth = pop.wealth || {};
      const political = pop.political || {};
      const migrationData = pop.migration || {};
      const interestGroups = pop.interest_groups || {};
      const culture = pop.culture || '';
      const religion = pop.religion || '';

      // Логирование типа провинции
      messages.push(`[Отладка] Аггрегация данных для ${provinceType} провинции с ID: ${pop.province_id}`);

      // Суммирование населения по профессиям
      if (employment.professions && typeof employment.professions === 'object') {
        for (const [profession, count] of Object.entries(employment.professions)) {
          if (typeof count === 'number') {
            aggregation.professions[profession] = (aggregation.professions[profession] || 0) + count;
          } else {
            messages.push(`[Предупреждение] Некорректное значение профессии "${profession}" в строке ${rowIndex}.`);
          }
        }
      }

      // Суммирование групп интересов с детализацией
      if (interestGroups && typeof interestGroups === 'object') {
        for (const [groupName, groupData] of Object.entries(interestGroups)) {
          if (!aggregation.interest_groups[groupName]) {
            aggregation.interest_groups[groupName] = { total: 0, radicals: 0, loyalists: 0, neutrals: 0 };
          }
          const radicals = typeof groupData.radicals === 'number' ? groupData.radicals : 0;
          const loyalists = typeof groupData.loyalists === 'number' ? groupData.loyalists : 0;
          const neutrals = typeof groupData.neutral === 'number' ? groupData.neutral : 0;
          aggregation.interest_groups[groupName].total += radicals + loyalists + neutrals;
          aggregation.interest_groups[groupName].radicals += radicals;
          aggregation.interest_groups[groupName].loyalists += loyalists;
          aggregation.interest_groups[groupName].neutrals += neutrals;
        }
      }

      // Политические данные
      if (political) {
        aggregation.political.radicals += typeof political.radicals === 'number' ? political.radicals : 0;
        aggregation.political.loyalists += typeof political.loyalists === 'number' ? political.loyalists : 0;
        aggregation.political.neutrals += typeof political.neutral === 'number' ? political.neutral : 0;
      }

      // Миграционные данные
      if (migrationData) {
        aggregation.migration.incoming += typeof migrationData.incoming === 'number' ? migrationData.incoming : 0;
        aggregation.migration.outgoing += typeof migrationData.outgoing === 'number' ? migrationData.outgoing : 0;
      }

      // Богатство
      if (wealth && typeof wealth.money === 'number') {
        aggregation.wealth.money += wealth.money;
      }

      // Занятость
      if (employment) {
        aggregation.employment.total_workers += typeof employment.total_workers === 'number' ? employment.total_workers : 0;
        aggregation.employment.employed_workers += typeof employment.employed_workers === 'number' ? employment.employed_workers : 0;
        aggregation.employment.unemployed_workers += typeof employment.unemployed_workers === 'number' ? employment.unemployed_workers : 0;
      }

      // Гендерные данные
      if (demographics.gender_ratio && typeof demographics.gender_ratio === 'object') {
        aggregation.gender.male += typeof demographics.gender_ratio.male === 'number' ? demographics.gender_ratio.male : 0;
        aggregation.gender.female += typeof demographics.gender_ratio.female === 'number' ? demographics.gender_ratio.female : 0;
      }

      // Культура
      if (culture && typeof culture === 'string') {
        aggregation.culture[culture] = (aggregation.culture[culture] || 0) + (typeof demographics.total_population === 'number' ? demographics.total_population : 0);
      }

      // Религия
      if (religion && typeof religion === 'string') {
        aggregation.religion[religion] = (aggregation.religion[religion] || 0) + (typeof demographics.total_population === 'number' ? demographics.total_population : 0);
      }

      // Общее население
      aggregation.total_population += typeof demographics.total_population === 'number' ? demographics.total_population : 0;
    }

    // Проход по всем записям населения
    populationData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (cell) {
        try {
          const populationEntry = JSON.parse(cell);
          if (Array.isArray(populationEntry.pops)) {
            populationEntry.pops.forEach((pop) => {
              if (pop.province_id && typeof pop.province_id === 'string') {
                if (ownProvinces.includes(pop.province_id)) {
                  aggregateData(pop, aggregatedOwn, rowIndex + 1, 'собственной');
                } else if (otherProvinces.includes(pop.province_id)) {
                  aggregateData(pop, aggregatedOther, rowIndex + 1, 'чужой');
                } else {
                  // Провинция не принадлежит ни собственному государству, ни другим известным
                  messages.push(`[Предупреждение] Провинция "${pop.province_id}" в строке ${rowIndex + 1} не принадлежит ни вашему государству, ни другим известным.`);
                }
              } else {
                messages.push(`[Предупреждение] В записи населения в строке ${rowIndex + 1} отсутствует или некорректен "province_id".`);
              }
            });
          } else {
            messages.push(`[Предупреждение] В записи населения в строке ${rowIndex + 1} ключ "pops" не является массивом.`);
          }
        } catch (e) {
          messages.push(`[Ошибка] Парсинг JSON населения в строке ${rowIndex + 1}: ${e.message}`);
        }
      } else {
        messages.push(`[Предупреждение] Ячейка с населением в строке ${rowIndex + 1} пуста.`);
      }
    });

    // Логирование агрегированных данных перед записью
    messages.push(`[Отладка] aggregatedOwn: ${JSON.stringify(aggregatedOwn, null, 2)}`);
    messages.push(`[Отладка] aggregatedOther: ${JSON.stringify(aggregatedOther, null, 2)}`);

    // Формирование результирующих JSON с детализированными группами интересов
    const resultJsonOwn = JSON.stringify(aggregatedOwn, null, 2);
    const resultJsonOther = JSON.stringify(aggregatedOther, null, 2);

    // Обновление данных в Переменные_Основные с добавлением ключей, если их нет
    updateStateVariables(data['Переменные_Основные'], resultJsonOwn, resultJsonOther, messages);

    return messages;

  } catch (error) {
    messages.push(`[Критическая ошибка] aggregatePopulationDataWithInterestGroupDetails: ${error.message}`);
    return messages;
  }
}

/**
 * Вспомогательная функция для обновления Переменные_Основные с учетом наличия строк и ключей
 * @param {Array} stateVariables - Массив данных из Переменные_Основные
 * @param {string} resultJsonOwn - JSON строка для собственных провинций
 * @param {string} resultJsonOther - JSON строка для чужих провинций
 * @param {Array} messages - Массив сообщений для добавления предупреждений/ошибок
 */
function updateStateVariables(stateVariables, resultJsonOwn, resultJsonOther, messages) {
  // Предполагается, что:
  // - Первая строка содержит исходные данные (stateData)
  // - Вторая строка будет для собственных провинций
  // - Третья строка будет для чужих провинций

  // Обновляем или добавляем вторую строку
  if (stateVariables.length >= 2) {
    stateVariables[1][0] = mergeJson(stateVariables[1][0], resultJsonOwn, messages, 2);
  } else {
    // Добавляем необходимые строки до второй
    while (stateVariables.length < 2) {
      stateVariables.push(['']);
    }
    stateVariables[1][0] = resultJsonOwn;
    messages.push('[Отладка] Добавлена вторая строка для собственных провинций.');
  }

  // Обновляем или добавляем третью строку
  if (stateVariables.length >= 3) {
    stateVariables[2][0] = mergeJson(stateVariables[2][0], resultJsonOther, messages, 3);
  } else {
    // Добавляем необходимые строки до третьей
    while (stateVariables.length < 3) {
      stateVariables.push(['']);
    }
    stateVariables[2][0] = resultJsonOther;
    messages.push('[Отладка] Добавлена третья строка для чужих провинций.');
  }
}

/**
 * Вспомогательная функция для слияния существующего JSON с новым, добавляя недостающие ключи
 * @param {string} existingJson - Существующий JSON в ячейке
 * @param {string} newJson - Новый JSON для слияния
 * @param {Array} messages - Массив сообщений для добавления предупреждений/ошибок
 * @param {number} rowNumber - Номер строки для сообщений
 * @returns {string} mergedJson - Объединённый JSON строка
 */
function mergeJson(existingJson, newJson, messages, rowNumber) {
  let existingObj = {};
  let newObj = {};

  // Парсинг существующего JSON
  if (existingJson) {
    try {
      existingObj = JSON.parse(existingJson);
      messages.push(`[Отладка] Существующий JSON в строке ${rowNumber} успешно распарсен.`);
    } catch (e) {
      messages.push(`[Предупреждение] Парсинг существующего JSON в строке ${rowNumber}: ${e.message}. Перезапись данными.`);
      existingObj = {};
    }
  }

  // Парсинг нового JSON
  try {
    newObj = JSON.parse(newJson);
    messages.push(`[Отладка] Новый JSON в строке ${rowNumber} успешно распарсен.`);
  } catch (e) {
    messages.push(`[Ошибка] Парсинг нового JSON в строке ${rowNumber}: ${e.message}`);
    return existingJson; // Возвращаем существующий JSON, если новый некорректен
  }

  // Слияние объектов, добавление недостающих ключей
  for (const key in newObj) {
    if (newObj.hasOwnProperty(key)) {
      if (!existingObj.hasOwnProperty(key)) {
        existingObj[key] = newObj[key];
        messages.push(`[Информация] Добавлен новый ключ "${key}" в строку ${rowNumber}.`);
      } else {
        // Если ключ существует, обновляем значение
        existingObj[key] = newObj[key];
        messages.push(`[Отладка] Обновлен ключ "${key}" в строке ${rowNumber}.`);
      }
    }
  }

  return JSON.stringify(existingObj, null, 2);
}
