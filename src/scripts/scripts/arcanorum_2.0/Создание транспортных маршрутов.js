/**
 * Функция для обновления доступности ресурсов типа "land" и различных категорий на основе оптимальных маршрутов
 * @param {Object} data - Объект с данными из именованных диапазонов.
 * @param {Spreadsheet} spreadsheet - Активная таблица.
 * @returns {Array} messages - Массив сообщений для журнала событий.
 */
function updateLandResourcesAvailable(data, spreadsheet) {
  let messages = [];
  
  try {
    // Извлечение stateName и accessible_countries из Переменные_Основные
    const variablesData = data['Переменные_Основные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      messages.push(`[Ошибка][updateLandResourcesAvailable] Переменные_Основные пуст или не содержит необходимых данных.`);
      return messages;
    }

    let stateName, accessibleCountries;
    try {
      const variables = JSON.parse(variablesData[0][0]);
      if (!variables.state_name) {
        messages.push(`[Ошибка][updateLandResourcesAvailable] Переменные_Основные не содержит ключа "state_name".`);
        return messages;
      }
      stateName = variables.state_name;

      if (!variables.accessible_countries || !Array.isArray(variables.accessible_countries)) {
        messages.push(`[Ошибка][updateLandResourcesAvailable] Переменные_Основные не содержит ключа "accessible_countries" или он не является массивом.`);
        return messages;
      }
      accessibleCountries = variables.accessible_countries;
    } catch (e) {
      messages.push(`[Ошибка][updateLandResourcesAvailable] Ошибка при парсинге JSON из Переменные_Основные: ${e.message}`);
      return messages;
    }

    // Парсинг провинций
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      messages.push(`[Ошибка][updateLandResourcesAvailable] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
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
            messages.push(`[Ошибка][updateLandResourcesAvailable] Провинция в строке ${index + 1} не содержит ключа "id".`);
          }
        } catch (e) {
          messages.push(`[Ошибка][updateLandResourcesAvailable] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
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
      messages.push(`[Ошибка][updateLandResourcesAvailable] Не найдена столица (is_capital=true) среди провинций нашего государства.`);
      return messages;
    }

    messages.push(`[Информация][updateLandResourcesAvailable] Найдена столица: ${capitalProvinceId}.`);

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

    // Парсинг transport_infrastructure для всех разрешённых провинций (включая другие страны)
    const transportInfrastructureMap = {}; // provinceId -> transport_infrastructure Object

    const allAllowedProvinces = [...stateProvinces, ...allowedOtherProvinces];

    allAllowedProvinces.forEach(provinceId => {
      const province = provincesMap[provinceId];
      if (province && province.transport_infrastructure) {
        transportInfrastructureMap[provinceId] = province.transport_infrastructure;
      } else {
        messages.push(`[Предупреждение][updateLandResourcesAvailable] Провинция ${provinceId} не содержит "transport_infrastructure".`);
        // Инициализация с нулевыми значениями для отсутствующей транспортной инфраструктуры
        transportInfrastructureMap[provinceId] = {
          types: [
            {
              type: "land",
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
            }
          ]
        };
      }
    });

    // Определение категорий ресурсов, которые нужно обработать
    const resourceCategories = ["gas", "liquid", "goods", "service", "energy"];
    const transportType = "land"; // Тип транспорта, который обрабатываем

    // Обработка каждой провинции нашего государства
    stateProvinces.forEach(destinationId => {
      if (destinationId === capitalProvinceId) {
        // Столица сама по себе, пропускаем (можно убрать, если нужно обновлять столицу)
        return;
      }

      // Поиск всех маршрутов от столицы до destinationId
      const routes = findAllRoutes(capitalProvinceId, destinationId, allowedProvincesForRoutes);

      if (routes.length === 0) {
        messages.push(`[Информация][updateLandResourcesAvailable] Нет доступных маршрутов от столицы (${capitalProvinceId}) до провинции ${destinationId}.`);
        return;
      }

      // Для каждой категории ресурса обрабатываем маршруты
      resourceCategories.forEach(resource => {
        // Для каждого маршрута вычисляем минимальное значение transportType.resource.capacity
        let optimalRoute = null;
        let maxMinValue = -Infinity;

        routes.forEach(route => {
          let minValue = Infinity;
          route.forEach(provinceId => {
            const transport = transportInfrastructureMap[provinceId];
            if (transport && transport.types) {
              const typeObj = transport.types.find(t => t.type === transportType);
              if (typeObj && typeObj.capacity && typeof typeObj.capacity[resource] === 'number') {
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
              messages.push(`[Обновление][updateLandResourcesAvailable] Провинция ${destinationId}: available.${transportType}.${resource} установлено в ${typeObj.available[resource]} на основе маршрута ${optimalRoute.join(' -> ')}.`);
            } else {
              messages.push(`[Ошибка][updateLandResourcesAvailable] Провинция ${destinationId} не содержит ключей "${transportType}" или "available.${resource}" в transport_infrastructure.`);
            }
          } else {
            messages.push(`[Ошибка][updateLandResourcesAvailable] Провинция ${destinationId} не содержит "transport_infrastructure".`);
          }
        } else {
          messages.push(`[Информация][updateLandResourcesAvailable] Не найден оптимальный маршрут для провинции ${destinationId} и ресурса ${resource}.`);
        }
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
    messages.push(`[Ошибка][updateLandResourcesAvailable] ${error.message}`);
  }

  return messages;
}
