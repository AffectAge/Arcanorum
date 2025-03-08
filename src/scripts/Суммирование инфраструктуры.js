/**
 * Функция для обработки транспортной инфраструктуры зданий и обновления провинций.
 * @param {Object} data - Объект с данными из именованных диапазонов.
 * @param {Sheet} sheet - Активный лист (не используется, но включен для совместимости).
 * @param {Spreadsheet} spreadsheet - Активная таблица (может быть использована для логирования).
 * @returns {Array<string>} messages - Массив сообщений об обработке.
 */
function processTransportInfrastructure(data, sheet, spreadsheet) {
  const messages = [];
  try {
    // 1. Проверка наличия необходимых диапазонов.
    const templatesData = data['Постройки_Шаблоны'];
    const buildingsData = data['Постройки_ОсновнаяИнформация'];
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    const variablesData = data['Переменные'];
    if (!templatesData || templatesData.length === 0) {
      messages.push('[Ошибка][processTransportInfrastructure] Именной диапазон "Постройки_Шаблоны" пуст или не содержит данных.');
      return messages;
    }
    if (!buildingsData || buildingsData.length === 0) {
      messages.push('[Ошибка][processTransportInfrastructure] Именной диапазон "Постройки_ОсновнаяИнформация" пуст или не содержит данных.');
      return messages;
    }
    if (!provincesData || provincesData.length === 0) {
      messages.push('[Ошибка][processTransportInfrastructure] Именной диапазон "Провинции_ОсновнаяИнформация" пуст или не содержит данных.');
      return messages;
    }
    if (!variablesData || variablesData.length === 0) {
      messages.push('[Ошибка][processTransportInfrastructure] Именной диапазон "Переменные" пуст или не содержит данных.');
      return messages;
    }

    // 2. Извлекаем state_name из "Переменные".
    let stateName;
    try {
      const targetIdentifier = 'Основные данные государства';
      const targetRow = variablesData.find(row => row[0] === targetIdentifier);
      if (targetRow && targetRow[1]) {
        const jsonMatch = targetRow[1].match(/\{.*\}/);
        if (jsonMatch) {
          const variablesJson = JSON.parse(jsonMatch[0]);
          stateName = variablesJson.state_name;
          if (!stateName) {
            messages.push('[Ошибка][processTransportInfrastructure] Ключ "state_name" не найден в Переменные.');
            return messages;
          }
        } else {
          throw new Error('Не удалось извлечь JSON из Переменные.');
        }
      } else {
        throw new Error(`Идентификатор "${targetIdentifier}" не найден в Переменные.`);
      }
    } catch (e) {
      messages.push(`[Ошибка][processTransportInfrastructure] Ошибка при парсинге Переменные: ${e.message}`);
      return messages;
    }

    // 3. Создаем карту шаблонов по имени, отбирая только те, где есть transport_infrastructure.
    const transportTemplates = {};
    templatesData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (cell && cell.trim() !== "") {
        try {
          const template = JSON.parse(cell);
          if (template.transport_infrastructure) {
            if (!template.name) {
              messages.push(`[Ошибка][processTransportInfrastructure] Шаблон в строке ${rowIndex + 1} не содержит ключ "name".`);
            } else {
              transportTemplates[template.name] = template;
            }
          }
        } catch (e) {
          messages.push(`[Ошибка][processTransportInfrastructure] Парсинг шаблона в строке ${rowIndex + 1}: ${e.message}`);
        }
      }
    });

    // 4. Обработка зданий из "Постройки_ОсновнаяИнформация".
    buildingsData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (!cell || cell.trim() === "") return;
      try {
        let buildingsArray = JSON.parse(cell);
        let updated = false;
        buildingsArray.forEach(building => {
          // Проверяем принадлежность и статус.
          if (building.building_owner !== stateName || building.status !== "Активная") return;
          // Находим соответствующий шаблон по совпадению building_name и template.name.
          const template = transportTemplates[building.building_name];
          if (!template) return;
          // Получаем коэффициент транспортной эффективности и уровень здания.
          let transportEfficiency = 1;
          if (building.building_modifiers && typeof building.building_modifiers.transport_efficiency === 'number') {
            transportEfficiency = building.building_modifiers.transport_efficiency;
          } else {
            messages.push(`[Предупреждение][processTransportInfrastructure] Здание "${building.building_name}" не содержит корректный "transport_efficiency" в building_modifiers. Используем 1.`);
          }
          const buildingLevel = (typeof building.building_level === 'number') ? building.building_level : 1;
          const multiplier = transportEfficiency * buildingLevel;
          // Вычисляем новый объект transport_infrastructure по шаблону.
          const templateTI = template.transport_infrastructure;
          if (!templateTI.types || !Array.isArray(templateTI.types)) {
            messages.push(`[Ошибка][processTransportInfrastructure] В шаблоне здания "${template.name}" отсутствует или некорректно задан ключ "types" в transport_infrastructure.`);
            return;
          }
          const computedTI = { types: [] };
          templateTI.types.forEach(typeObj => {
            if (!typeObj.type || !typeObj.capacity) return;
            const newTypeObj = { type: typeObj.type, capacity: {} };
            // Для каждого ресурса умножаем значение на multiplier.
            Object.keys(typeObj.capacity).forEach(resource => {
              const baseValue = typeObj.capacity[resource];
              if (typeof baseValue === 'number') {
                newTypeObj.capacity[resource] = baseValue * multiplier;
              }
            });
            computedTI.types.push(newTypeObj);
          });
          // В обоих случаях (наличие или отсутствие ключа) устанавливаем computedTI.
          building.transport_infrastructure = computedTI;
          updated = true;
        });
        if (updated) {
          buildingsData[rowIndex][0] = JSON.stringify(buildingsArray);
        }
      } catch (e) {
        messages.push(`[Ошибка][processTransportInfrastructure] Парсинг зданий в строке ${rowIndex + 1}: ${e.message}`);
      }
    });

    // 5. Суммирование transport_infrastructure зданий по провинциям.
    // Создаем словарь, где для каждой провинции накапливаются данные из зданий.
    const provinceBuildingSums = {};
    buildingsData.forEach(row => {
      const cell = row[0];
      if (!cell || cell.trim() === "") return;
      try {
        const buildingsArray = JSON.parse(cell);
        buildingsArray.forEach(building => {
          // Рассматриваем только здания нашего государства, со статусом "Активная" и с заданной транспортной инфраструктурой.
          if (building.building_owner === stateName && building.status === "Активная" && building.transport_infrastructure) {
            const pid = building.province_id;
            if (!pid) return;
            if (!provinceBuildingSums[pid]) {
              provinceBuildingSums[pid] = {};
            }
            // Для каждого типа здания накапливаем значения по ресурсам.
            building.transport_infrastructure.types.forEach(bType => {
              if (!bType.type || !bType.capacity) return;
              if (!provinceBuildingSums[pid][bType.type]) {
                provinceBuildingSums[pid][bType.type] = {};
              }
              Object.keys(bType.capacity).forEach(resource => {
                const value = bType.capacity[resource];
                if (typeof value === 'number') {
                  if (!provinceBuildingSums[pid][bType.type][resource]) {
                    provinceBuildingSums[pid][bType.type][resource] = 0;
                  }
                  provinceBuildingSums[pid][bType.type][resource] += value;
                }
              });
            });
          }
        });
      } catch (e) {
        messages.push(`[Ошибка][processTransportInfrastructure] Парсинг зданий для суммирования: ${e.message}`);
      }
    });

    // 6. Обработка провинций, принадлежащих нашему государству.
    provincesData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (!cell || cell.trim() === "") return;
      try {
        const province = JSON.parse(cell);
        if (province.owner !== stateName) return;
        // Проверяем наличие transport_infrastructure в провинции.
        if (!province.transport_infrastructure || !province.transport_infrastructure.types || !Array.isArray(province.transport_infrastructure.types)) {
          messages.push(`[Предупреждение][processTransportInfrastructure] В провинции с id "${province.id}" отсутствует корректно заданный ключ transport_infrastructure.`);
          return;
        }
        // Обнуляем значения capacity и available для каждой группы.
        province.transport_infrastructure.types.forEach(typeObj => {
          if (typeObj.capacity) {
            Object.keys(typeObj.capacity).forEach(resource => {
              typeObj.capacity[resource] = 0;
            });
          }
          if (typeObj.available) {
            Object.keys(typeObj.available).forEach(resource => {
              typeObj.available[resource] = 0;
            });
          }
        });
        // Добавляем накопленные значения из зданий.
        const sumsForProvince = provinceBuildingSums[province.id];
        if (sumsForProvince) {
          province.transport_infrastructure.types.forEach(typeObj => {
            const typeKey = typeObj.type;
            const sumForType = sumsForProvince[typeKey];
            if (sumForType) {
              Object.keys(sumForType).forEach(resource => {
                const addition = sumForType[resource];
                if (typeObj.capacity) {
                  typeObj.capacity[resource] = (typeObj.capacity[resource] || 0) + addition;
                }
              });
            }
          });
        }

        // После суммирования устанавливаем available равным capacity.
province.transport_infrastructure.types.forEach(typeObj => {
  if (typeObj.capacity) {
    Object.keys(typeObj.capacity).forEach(resource => {
      typeObj.available[resource] = typeObj.capacity[resource];
    });
  }
});

        // Обновляем данные провинции.
        provincesData[rowIndex][0] = JSON.stringify(province);
      } catch (e) {
        messages.push(`[Ошибка][processTransportInfrastructure] Парсинг провинции в строке ${rowIndex + 1}: ${e.message}`);
      }
    });

    return messages;
  } catch (error) {
    messages.push(`[Ошибка][processTransportInfrastructure] ${error.message}`);
    return messages;
  }
}
