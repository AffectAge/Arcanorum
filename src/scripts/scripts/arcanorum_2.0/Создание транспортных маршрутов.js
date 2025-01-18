/**
 * Функция для обновления доступности ресурсов на основе оптимальных маршрутов для различных типов транспорта
 * @param {Object} data - Объект с данными из именованных диапазонов.
 * @param {Spreadsheet} spreadsheet - Активная таблица.
 * @returns {Array} messages - Массив сообщений для журнала событий.
 */
function updateResourcesAvailable(data, spreadsheet) {
  let messages = [];
  
  try {
    // Извлечение stateName и accessible_countries из Переменные_Основные
    const variablesData = data['Переменные_Основные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      messages.push(`[Ошибка][updateResourcesAvailable] Переменные_Основные пуст или не содержит необходимых данных.`);
      return messages;
    }

    let stateName, accessibleCountries;
    try {
      const variables = JSON.parse(variablesData[0][0]);
      if (!variables.state_name) {
        messages.push(`[Ошибка][updateResourcesAvailable] Переменные_Основные не содержит ключа "state_name".`);
        return messages;
      }
      stateName = variables.state_name;

      if (!variables.accessible_countries || !Array.isArray(variables.accessible_countries)) {
        messages.push(`[Ошибка][updateResourcesAvailable] Переменные_Основные не содержит ключа "accessible_countries" или он не является массивом.`);
        return messages;
      }
      accessibleCountries = variables.accessible_countries;
    } catch (e) {
      messages.push(`[Ошибка][updateResourcesAvailable] Ошибка при парсинге JSON из Переменные_Основные: ${e.message}`);
      return messages;
    }

    // Парсинг провинций
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      messages.push(`[Ошибка][updateResourcesAvailable] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
      return messages;
    }

    const provincesMap = {}; // id -> provinceObject
    const stateProvinces = []; // Провинции нашего государства
    const allowedOtherProvinces = []; // Провинции других государств, доступные для маршрутов

    provincesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const province = JSON.parse(cell);
          if (province.id) {
            provincesMap[province.id] = province;
            if (province.owner === stateName) {
              stateProvinces.push(province.id);
            } else if (accessibleCountries.includes(province.owner)) {
              allowedOtherProvinces.push(province.id);
            }
          } else {
            messages.push(`[Ошибка][updateResourcesAvailable] Провинция в строке ${index + 1} не содержит ключа "id".`);
          }
        } catch (e) {
          messages.push(`[Ошибка][updateResourcesAvailable] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    // Поиск столицы
    let capitalProvinceId = null;
    stateProvinces.forEach(provinceId => {
      const province = provincesMap[provinceId];
      if (province && province.is_capital === true) {
        capitalProvinceId = provinceId;
      }
    });

    if (!capitalProvinceId) {
      messages.push(`[Ошибка][updateResourcesAvailable] Не найдена столица (is_capital=true) среди провинций нашего государства.`);
      return messages;
    }

    messages.push(`[Информация][updateResourcesAvailable] Найдена столица: ${capitalProvinceId}.`);

    // Функция для поиска всех маршрутов от столицы до заданной провинции
    function findAllRoutes(startId, endId, allowedProvinces) {
      let routes = [];
      let queue = [[startId]];
      
      while (queue.length > 0) {
        let path = queue.shift();
        let last = path[path.length - 1];

        if (last === endId) {
          routes.push(path);
          continue;
        }

        if (!provincesMap[last] || !provincesMap[last].neighbors) {
          continue;
        }

        provincesMap[last].neighbors.forEach(neighborId => {
          if (allowedProvinces.includes(neighborId) && !path.includes(neighborId)) {
            queue.push([...path, neighborId]);
          }
        });
      }

      return routes;
    }

    // Определение разрешённых провинций для маршрутов
    const allowedProvincesForRoutes = [...stateProvinces, ...allowedOtherProvinces];

    // Определение типов транспорта и категорий ресурсов
    const transportTypes = ["land", "air", "water", "space"]; // Добавляем новые типы транспорта
    const resourceCategories = ["gas", "liquid", "goods", "service", "energy"];

    // Парсинг transport_infrastructure для всех разрешённых провинций (включая другие страны)
    const transportInfrastructureMap = {}; // provinceId -> transport_infrastructure Object

    const allAllowedProvinces = [...stateProvinces, ...allowedOtherProvinces];

    allAllowedProvinces.forEach(provinceId => {
      const province = provincesMap[provinceId];
      if (province && province.transport_infrastructure) {
        // Проверка и добавление отсутствующих транспортных типов
        transportTypes.forEach(type => {
          let transportTypeObj = province.transport_infrastructure.types.find(t => t.type === type);
          if (!transportTypeObj) {
            // Добавляем отсутствующий тип транспорта с нулевыми значениями
            transportTypeObj = {
              type: type,
              capacity: {},
              available: {}
            };
            // Инициализируем все необходимые категории ресурсов с нулевыми значениями
            resourceCategories.forEach(resource => {
              transportTypeObj.capacity[resource] = 0;
              transportTypeObj.available[resource] = 0;
            });
            province.transport_infrastructure.types.push(transportTypeObj);
            messages.push(`[Предупреждение][updateResourcesAvailable] Провинция ${provinceId} не содержит тип транспорта "${type}". Добавлен с нулевыми значениями.`);
          } else {
            // Проверка и добавление отсутствующих категорий ресурсов
            resourceCategories.forEach(resource => {
              if (typeof transportTypeObj.capacity[resource] !== 'number') {
                transportTypeObj.capacity[resource] = 0;
                messages.push(`[Предупреждение][updateResourcesAvailable] Провинция ${provinceId}, транспорт "${type}" не содержит ресурс "capacity.${resource}". Установлено значение 0.`);
              }
              if (typeof transportTypeObj.available[resource] !== 'number') {
                transportTypeObj.available[resource] = 0;
                messages.push(`[Предупреждение][updateResourcesAvailable] Провинция ${provinceId}, транспорт "${type}" не содержит ресурс "available.${resource}". Установлено значение 0.`);
              }
            });
          }
        });
        transportInfrastructureMap[provinceId] = province.transport_infrastructure;
      } else {
        messages.push(`[Предупреждение][updateResourcesAvailable] Провинция ${provinceId} не содержит "transport_infrastructure". Инициализация с нулевыми значениями.`);
        // Инициализация с нулевыми значениями для отсутствующей транспортной инфраструктуры
        transportInfrastructureMap[provinceId] = {
          types: transportTypes.map(type => ({
            type: type,
            capacity: {
              gas: 0,
              liquid: 0,
              goods: 0,
              service: 0,
              energy: 0
            },
            available: {
              gas: 0,
              liquid: 0,
              goods: 0,
              service: 0,
              energy: 0
            }
          }))
        };
      }
    });

    // Обработка каждой провинции нашего государства
    stateProvinces.forEach(destinationId => {
      if (destinationId === capitalProvinceId) {
        // Столица сама по себе, пропускаем (можно убрать, если нужно обновлять столицу)
        return;
      }

      // Для каждого типа транспорта
      transportTypes.forEach(transportType => {
        resourceCategories.forEach(resource => {
          let routes = [];

          if (transportType === 'space') {
            // Для типа 'space' маршрут всегда прямой
            routes.push([capitalProvinceId, destinationId]);
          } else {
            // Для остальных типов транспорта ищем маршруты через allowedProvincesForRoutes
            routes = findAllRoutes(capitalProvinceId, destinationId, allowedProvincesForRoutes);
          }

          if (routes.length === 0) {
            messages.push(`[Информация][updateResourcesAvailable] Нет доступных маршрутов от столицы (${capitalProvinceId}) до провинции ${destinationId} для транспорта ${transportType}.`);
            return;
          }

          // Определяем оптимальный маршрут
          let optimalRoute = null;
          let maxMinValue = -Infinity;

          routes.forEach(route => {
            let minValue = Infinity;
            route.forEach(provinceId => {
              const transport = transportInfrastructureMap[provinceId];
              if (transport && transport.types) {
                const typeObj = transport.types.find(t => t.type === transportType);
                if (typeObj && typeof typeObj.capacity[resource] === 'number') {
                  if (typeObj.capacity[resource] < minValue) {
                    minValue = typeObj.capacity[resource];
                  }
                } else {
                  // Если нет данных по transportType.resource, считаем минимальное значение как 0
                  minValue = 0;
                }
              } else {
                // Если нет transport_infrastructure, считаем минимальное значение как 0
                minValue = 0;
              }
            });

            if (minValue > maxMinValue) {
              maxMinValue = minValue;
              optimalRoute = route;
            }
          });

          if (optimalRoute) {
            // Установка available.transportType.resource в минимальное значение маршрута для destinationId
            const destinationTransport = transportInfrastructureMap[destinationId];
            if (destinationTransport && destinationTransport.types) {
              const typeObj = destinationTransport.types.find(t => t.type === transportType);
              if (typeObj && typeObj.available && typeof typeObj.available[resource] === 'number') {
                typeObj.available[resource] = maxMinValue; // Заменяем вместо Math.min
                messages.push(`[Обновление][updateResourcesAvailable] Провинция ${destinationId}: available.${transportType}.${resource} установлено в ${typeObj.available[resource]} на основе маршрута ${optimalRoute.join(' -> ')}.`);
              } else {
                messages.push(`[Ошибка][updateResourcesAvailable] Провинция ${destinationId} не содержит ключей "${transportType}" или "available.${resource}" в transport_infrastructure.`);
              }
            } else {
              messages.push(`[Ошибка][updateResourcesAvailable] Провинция ${destinationId} не содержит "transport_infrastructure".`);
            }
          } else {
            messages.push(`[Информация][updateResourcesAvailable] Не найден оптимальный маршрут для провинции ${destinationId}, ресурса ${resource} и транспорта ${transportType}.`);
          }
        });
      });
    });

    // Обновление данных провинций в data['Провинции_ОсновнаяИнформация']
    const updatedProvincesData = data['Провинции_ОсновнаяИнформация'].map((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const province = JSON.parse(cell);
          if (province.id && transportInfrastructureMap[province.id]) {
            // Обновляем transport_infrastructure
            province.transport_infrastructure = transportInfrastructureMap[province.id];
            return [JSON.stringify(province)];
          } else {
            return row;
          }
        } catch (e) {
          // Если ошибка при парсинге, возвращаем исходную строку
          return row;
        }
      } else {
        return row;
      }
    });

    // Обновляем data
    data['Провинции_ОсновнаяИнформация'] = updatedProvincesData;

  } catch (error) {
    messages.push(`[Ошибка][updateResourcesAvailable] ${error.message}`);
  }

  return messages;
}
