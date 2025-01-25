/**
 * Функция для обновления доступности ресурсов на основе оптимальных маршрутов для различных типов транспорта
 *
 * @param {Object} data - Объект с данными из именованных диапазонов.
 * @param {Spreadsheet} spreadsheet - Активная таблица.
 * @returns {Array} messages - Массив сообщений для журнала событий.
 */
function updateResourcesAvailable(data, spreadsheet) {
  let messages = [];

  try {
    // Создаем более описательное название типа транспорта
    const transportTypeDescriptions = {
      land: 'Наземный транспорт',
      air: 'Воздушный транспорт',
      water: 'Водный транспорт',
      space: 'Космический транспорт'
    };

    // Создаем более описательное название категории ресурсов
    const resourceCategoryDescriptions = {
      goods: 'Товары',
      // Добавьте другие категории ресурсов по необходимости
      // Например:
      // food: 'Продукты питания',
      // minerals: 'Минералы',
    };

    // Извлечение stateName из первой строки Переменные_Основные
    const variablesData = data['Переменные_Основные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      messages.push(`[Ошибка][updateResourcesAvailable] Переменные_Основные пуст или не содержит необходимых данных в первой строке.`);
      return messages;
    }

    let stateName;
    try {
      const variables = JSON.parse(variablesData[0][0]);
      if (!variables.state_name) {
        messages.push(`[Ошибка][updateResourcesAvailable] Переменные_Основные не содержит ключа "state_name" в первой строке.`);
        return messages;
      }
      stateName = variables.state_name;
    } catch (e) {
      messages.push(`[Ошибка][updateResourcesAvailable] Ошибка при парсинге JSON из первой строки Переменные_Основные: ${e.message}`);
      return messages;
    }

    // Извлечение accessible_countries из пятой строки Переменные_Основные
    if (variablesData.length < 5 || !variablesData[4][0]) { // Индексация с 0, значит 5-я строка имеет индекс 4
      messages.push(`[Ошибка][updateResourcesAvailable] Переменные_Основные не содержит 5-й строки или она пуста.`);
      return messages;
    }

    let accessibleCountries;
    try {
      // Предполагается, что 5-я строка содержит JSON-массив accessible_countries
      const accessibleCountriesData = JSON.parse(variablesData[4][0]);
      if (!Array.isArray(accessibleCountriesData)) {
        messages.push(`[Ошибка][updateResourcesAvailable] 5-я строка Переменные_Основные не содержит массив "accessible_countries".`);
        return messages;
      }
      accessibleCountries = accessibleCountriesData.map(country => country.toLowerCase()); // Приводим к нижнему регистру для согласованности
    } catch (e) {
      messages.push(`[Ошибка][updateResourcesAvailable] Ошибка при парсинге JSON из 5-й строки Переменные_Основные: ${e.message}`);
      return messages;
    }

    // Извлечение настроек из Настройки
    const settingsData = data['Настройки'];
    if (!settingsData || settingsData.length === 0) {
      messages.push(`[Ошибка][updateResourcesAvailable] Настройки пуст или не содержит данных.`);
      return messages;
    }

    let coastalLandscapes = [];
    let transportTypes = [];
    let resourceCategories = [];
    let allowedLandscapes = {};
    try {
      // Поиск строк по ключам (без учета регистра)
      const transportTypesRow = settingsData.find(row => row[0] && row[0].toLowerCase() === 'типы транспорта');
      if (!transportTypesRow || !transportTypesRow[1]) {
        messages.push(`[Ошибка][updateResourcesAvailable] Не найдена строка "Типы транспорта" в Настройках.`);
        return messages;
      }
      transportTypes = JSON.parse(transportTypesRow[1]);
      if (!Array.isArray(transportTypes) || transportTypes.length === 0) {
        messages.push(`[Ошибка][updateResourcesAvailable] "Типы транспорта" в Настройках не является массивом или пуст.`);
        return messages;
      }

      const resourceCategoriesRow = settingsData.find(row => row[0] && row[0].toLowerCase() === 'категории товаров');
      if (!resourceCategoriesRow || !resourceCategoriesRow[1]) {
        messages.push(`[Ошибка][updateResourcesAvailable] Не найдена строка "Категории товаров" в Настройках.`);
        return messages;
      }
      resourceCategories = JSON.parse(resourceCategoriesRow[1]);
      if (!Array.isArray(resourceCategories) || resourceCategories.length === 0) {
        messages.push(`[Ошибка][updateResourcesAvailable] "Категории товаров" в Настройках не является массивом или пуст.`);
        return messages;
      }

      // Извлечение coastal_landscapes
      const coastalLandscapesRow = settingsData.find(row => row[0] && row[0].toLowerCase() === 'настройки торговых путей');
      if (!coastalLandscapesRow || !coastalLandscapesRow[1]) {
        messages.push(`[Ошибка][updateResourcesAvailable] Не найдена строка "Настройки торговых путей" в Настройках.`);
        return messages;
      }
      const settingsObject = JSON.parse(coastalLandscapesRow[1]);
      if (!settingsObject.coastal_landscapes || !Array.isArray(settingsObject.coastal_landscapes)) {
        messages.push(`[Ошибка][updateResourcesAvailable] Настройки торговых путей не содержат ключа "coastal_landscapes" или он не является массивом.`);
        return messages;
      }
      coastalLandscapes = settingsObject.coastal_landscapes.map(landscape => landscape.toLowerCase()); // Приводим к нижнему регистру

      // Извлечение allowedLandscapes
      const allowedLandscapesRow = settingsData.find(row => row[0] && row[0].toLowerCase() === 'ландшафты маршрутов');
      if (!allowedLandscapesRow || !allowedLandscapesRow[1]) {
        messages.push(`[Ошибка][updateResourcesAvailable] Не найдена строка "Ландшафты маршрутов" в Настройках.`);
        return messages;
      }
      allowedLandscapes = JSON.parse(allowedLandscapesRow[1]);
      if (typeof allowedLandscapes !== 'object' || Array.isArray(allowedLandscapes)) {
        messages.push(`[Ошибка][updateResourcesAvailable] "Ландшафты маршрутов" в Настройках не является объектом.`);
        return messages;
      }

      // Приведение всех ландшафтов к нижнему регистру
      Object.keys(allowedLandscapes).forEach(type => {
        if (Array.isArray(allowedLandscapes[type])) {
          allowedLandscapes[type] = allowedLandscapes[type].map(l => l.toLowerCase());
        } else {
          messages.push(`[Ошибка][updateResourcesAvailable] Для типа транспорта "${type}" ландшафты должны быть массивом.`);
          allowedLandscapes[type] = [];
        }
      });

    } catch (e) {
      messages.push(`[Ошибка][updateResourcesAvailable] Ошибка при парсинге настроек из Настроек: ${e.message}`);
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
            if (province.owner && typeof province.owner === 'string') {
              const ownerLower = province.owner.toLowerCase();
              if (ownerLower === stateName.toLowerCase()) {
                stateProvinces.push(province.id);
              } else if (accessibleCountries.includes(ownerLower)) {
                allowedOtherProvinces.push(province.id);
              }
            } else {
              messages.push(`[Ошибка][updateResourcesAvailable] Провинция в строке ${index + 1} не содержит корректного ключа "owner".`);
            }
          } else {
            messages.push(`[Ошибка][updateResourcesAvailable] Провинция в строке ${index + 1} не содержит ключа "id".`);
          }
        } catch (e) {
          messages.push(`[Ошибка][updateResourcesAvailable] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });

    // Отладочные сообщения для проверки разделения провинций
    messages.push(`[Отладка][updateResourcesAvailable] stateProvinces: ${JSON.stringify(stateProvinces)}`);
    messages.push(`[Отладка][updateResourcesAvailable] allowedOtherProvinces: ${JSON.stringify(allowedOtherProvinces)}`);

    // Поиск всех столиц, группируя их по планетам
    const capitalsByPlanet = {}; // planet -> capitalProvinceId
    stateProvinces.forEach(provinceId => {
      const province = provincesMap[provinceId];
      if (province && province.is_capital === true) {
        if (province.planet && Array.isArray(province.planet)) {
          province.planet.forEach(planet => {
            const planetLower = planet.toLowerCase();
            if (capitalsByPlanet[planetLower]) {
              messages.push(`[Предупреждение][updateResourcesAvailable] На планете "${planet}" уже существует столица "${capitalsByPlanet[planetLower]}". Дополнительная столица "${provinceId}" не будет учтена.`);
            } else {
              capitalsByPlanet[planetLower] = provinceId;
              messages.push(`[Транспортные маршруты][Информация] Найдена столица "${provinceId}" на планете "${planet}".`);
            }
          });
        } else {
          messages.push(`[Ошибка][updateResourcesAvailable] Провинция "${provinceId}" помечена как столица, но не содержит корректного списка планет.`);
        }
      }
    });

    if (Object.keys(capitalsByPlanet).length === 0) {
      messages.push(`[Ошибка][updateResourcesAvailable] Не найдены столиц среди провинций нашего государства.`);
      return messages;
    }

    // Функции для определения типов провинций
    function isCoastalProvince(province) {
      return province.landscapes && Array.isArray(province.landscapes) &&
             province.landscapes.map(l => l.toLowerCase()).some(l => coastalLandscapes.includes(l));
    }

    function isMarineProvince(province) {
      return province.landscapes && Array.isArray(province.landscapes) &&
             (province.landscapes.map(l => l.toLowerCase()).includes('sea') ||
              province.landscapes.map(l => l.toLowerCase()).includes('ocean'));
    }

    // Функция для поиска всех маршрутов от заданной столицы до заданной провинции с дополнительными условиями
    function findAllRoutes(startId, endId, allowedProvinces, transportType, planetFilter = null, allowedLandscapesForTransport = null, requireMarine = false) {
      let routes = [];
      let queue = [[startId]];

      while (queue.length > 0) {
        let path = queue.shift();
        let last = path[path.length - 1];

        if (last === endId) {
          if (requireMarine) {
            // Проверяем, что маршрут включает хотя бы одну морскую провинцию
            const hasMarine = path.some(provinceId => isMarineProvince(provincesMap[provinceId]));
            if (!hasMarine) continue;
          }
          routes.push(path);
          continue;
        }

        if (!provincesMap[last] || !provincesMap[last].neighbors) {
          continue;
        }

        provincesMap[last].neighbors.forEach(neighborId => {
          if (allowedProvinces.includes(neighborId) && !path.includes(neighborId)) {
            let canAdd = true;

            // Дополнительные условия для типа транспорта
            if (transportType === 'air' || transportType === 'land' || transportType === 'water') {
              if (planetFilter) {
                const neighborProvince = provincesMap[neighborId];
                if (neighborProvince && neighborProvince.planet && Array.isArray(neighborProvince.planet)) {
                  // Проверяем, находится ли провинция на выбранной планете
                  const hasPlanet = neighborProvince.planet.map(p => p.toLowerCase()).some(p => planetFilter.includes(p));
                  if (!hasPlanet) {
                    canAdd = false;
                  }
                } else {
                  canAdd = false;
                }
              }
            }

            // Дополнительные условия по ландшафтам для land и water
            if ((transportType === 'land' || transportType === 'water') && allowedLandscapesForTransport) {
              const neighborProvince = provincesMap[neighborId];
              if (neighborProvince && neighborProvince.landscapes && Array.isArray(neighborProvince.landscapes)) {
                // Проверяем наличие хотя бы одного допустимого ландшафта (без учёта регистра)
                const hasLandscape = neighborProvince.landscapes.map(l => l.toLowerCase()).some(l => allowedLandscapesForTransport.includes(l));
                if (!hasLandscape) {
                  canAdd = false;
                }
              } else {
                canAdd = false;
              }
            }

            if (canAdd) {
              queue.push([...path, neighborId]);
            }
          }
        });
      }

      return routes;
    }

    // Функция для поиска морских маршрутов, включающих как наземные, так и морские провинции
    function findAllMarineRoutes(startId, endId, allowedProvinces, transportType, provincesMap) {
      let routes = [];
      let queue = [[startId]];

      while (queue.length > 0) {
        let path = queue.shift();
        let last = path[path.length - 1];

        if (last === endId) {
          // Требовать, чтобы только конечная провинция была прибережной
          const provinceEnd = provincesMap[path[path.length - 1]];
          if (!isCoastalProvince(provinceEnd)) {
            continue;
          }

          // Проверяем, что маршрут включает морские провинции
          const hasMarine = path.some(provinceId => isMarineProvince(provincesMap[provinceId]));

          if (hasMarine) {
            routes.push(path);
          }
          continue;
        }

        if (!provincesMap[last] || !provincesMap[last].neighbors) {
          continue;
        }

        provincesMap[last].neighbors.forEach(neighborId => {
          if (allowedProvinces.includes(neighborId) && !path.includes(neighborId)) {
            let canAdd = true;

            // Для морских маршрутов допускаем как наземные, так и морские провинции
            // Дополнительные условия по планете
            const neighborProvince = provincesMap[neighborId];
            if (!neighborProvince || !neighborProvince.planet || !Array.isArray(neighborProvince.planet)) {
              canAdd = false;
            } else {
              // Убедимся, что провинция находится на той же планете, что и начальная
              const startPlanets = provincesMap[startId].planet.map(p => p.toLowerCase());
              const neighborPlanets = neighborProvince.planet.map(p => p.toLowerCase());
              const commonPlanets = startPlanets.filter(p => neighborPlanets.includes(p));
              if (commonPlanets.length === 0) {
                canAdd = false;
              }
            }

            if (canAdd) {
              queue.push([...path, neighborId]);
            }
          }
        });
      }

      return routes;
    }

    // Определение допустимых ландшафтов для каждого типа транспорта из allowedLandscapes
    const allowedLandscapesForEachTransport = {};
    transportTypes.forEach(transportType => {
      if (allowedLandscapes.hasOwnProperty(transportType)) {
        // Если массив пустой, значит, нет ограничений по ландшафтам
        if (allowedLandscapes[transportType].length > 0) {
          allowedLandscapesForEachTransport[transportType] = allowedLandscapes[transportType];
        } else {
          allowedLandscapesForEachTransport[transportType] = null; // Нет ограничений
        }
      } else {
        allowedLandscapesForEachTransport[transportType] = null; // Нет ограничений
      }
    });

    // Парсинг transport_infrastructure только для собственных провинций
    const transportInfrastructureMap = {}; // provinceId -> transport_infrastructure Object

    const ownProvinces = stateProvinces; // Только собственные провинции

    ownProvinces.forEach(provinceId => {
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
            messages.push(`[Предупреждение][updateResourcesAvailable] Провинция "${provinceId}" не содержит тип транспорта "${type}". Добавлен с нулевыми значениями.`);
          } else {
            // Проверка и добавление отсутствующих категорий ресурсов
            resourceCategories.forEach(resource => {
              if (typeof transportTypeObj.capacity[resource] !== 'number') {
                transportTypeObj.capacity[resource] = 0;
                messages.push(`[Предупреждение][updateResourcesAvailable] Провинция "${provinceId}", транспорт "${transportTypeDescriptions[type]}" не содержит ресурс "capacity.${resource}". Установлено значение 0.`);
              }
              if (typeof transportTypeObj.available[resource] !== 'number') {
                transportTypeObj.available[resource] = 0;
                messages.push(`[Предупреждение][updateResourcesAvailable] Провинция "${provinceId}", транспорт "${transportTypeDescriptions[type]}" не содержит ресурс "available.${resource}". Установлено значение 0.`);
              }
            });
          }
        });
        transportInfrastructureMap[provinceId] = province.transport_infrastructure;
      } else {
        messages.push(`[Предупреждение][updateResourcesAvailable] Провинция "${provinceId}" не содержит "transport_infrastructure". Инициализация с нулевыми значениями.`);
        // Инициализация с нулевыми значениями для отсутствующей транспортной инфраструктуры
        transportInfrastructureMap[provinceId] = {
          types: transportTypes.map(type => ({
            type: type,
            capacity: resourceCategories.reduce((acc, resource) => {
              acc[resource] = 0;
              return acc;
            }, {}),
            available: resourceCategories.reduce((acc, resource) => {
              acc[resource] = 0;
              return acc;
            }, {})
          }))
        };
      }
    });

    // Обработка каждой провинции нашего государства
    stateProvinces.forEach(destinationId => {
      const destinationProvince = provincesMap[destinationId];
      if (!destinationProvince) {
        messages.push(`[Ошибка][updateResourcesAvailable] Провинция "${destinationId}" не найдена в provincesMap.`);
        return;
      }

      // Определение планет, на которых находится провинция
      const destinationPlanets = destinationProvince.planet.map(p => p.toLowerCase());

      // Для каждой планеты провинции, найдите соответствующую столицу
      destinationPlanets.forEach(planet => {
        const capitalId = capitalsByPlanet[planet];
        if (!capitalId) {
          messages.push(`[Ошибка][updateResourcesAvailable] На планете "${planet}" не найдена столица для маршрутизации провинции "${destinationId}".`);
          return;
        }

        // Если провинция сама является столицей на этой планете, пропускаем
        if (destinationId === capitalId) {
          return;
        }

        // Для каждого типа транспорта
        transportTypes.forEach(transportType => {
          resourceCategories.forEach(resource => {
            let routes = [];

            // Определение допустимых провинций для данного типа транспорта
            let allowedProvincesForTransportType = [...stateProvinces, ...allowedOtherProvinces];

            // Определение дополнительных ограничений по ландшафтам
            let allowedLandscapesForTransport = null;
            if (allowedLandscapesForEachTransport.hasOwnProperty(transportType)) {
              if (allowedLandscapesForEachTransport[transportType] !== null) {
                allowedLandscapesForTransport = allowedLandscapesForEachTransport[transportType].map(l => l.toLowerCase());
                // Фильтруем провинции на основе допустимых ландшафтов
                allowedProvincesForTransportType = allowedProvincesForTransportType.filter(provinceId => {
                  const province = provincesMap[provinceId];
                  if (province && province.landscapes && Array.isArray(province.landscapes)) {
                    // Проверяем наличие хотя бы одного допустимого ландшафта (без учёта регистра)
                    return province.landscapes.map(l => l.toLowerCase()).some(l => allowedLandscapesForTransport.includes(l));
                  }
                  return false;
                });

                if (allowedProvincesForTransportType.length === 0) {
                  const transportTypeDesc = transportTypeDescriptions[transportType] || transportType;
                  const resourceCategoryDesc = resourceCategoryDescriptions[resource] || resource;
                  messages.push(`[Транспортные маршруты][Информация] Нет провинций, подходящих для транспорта "${transportTypeDesc}" и категории ресурсов "${resourceCategoryDesc}".`);
                  return; // Переходим к следующей итерации
                }
              }
              // Если allowedLandscapesForEachTransport[transportType] === null, нет ограничений по ландшафтам
            }

            // Определение допустимых планет для типов транспорта, требующих одной планеты
            let planetFilter = null;
            if (transportType === 'air' || transportType === 'land' || transportType === 'water') {
              const capitalProvince = provincesMap[capitalId];
              const destinationProvince = provincesMap[destinationId];

              if (!capitalProvince.planet || !Array.isArray(capitalProvince.planet) ||
                  !destinationProvince.planet || !Array.isArray(destinationProvince.planet)) {
                messages.push(`[Ошибка][updateResourcesAvailable] Провинции "${capitalId}" или "${destinationId}" не содержат корректных данных по ключу "planet".`);
                return; // Переходим к следующей итерации
              }

              // Определяем общие планеты между столицей и целевой провинцией
              const commonPlanets = capitalProvince.planet.map(p => p.toLowerCase()).filter(p => destinationProvince.planet.map(dp => dp.toLowerCase()).includes(p));

              if (commonPlanets.length === 0) {
                const transportTypeDesc = transportTypeDescriptions[transportType] || transportType;
                messages.push(`[Транспортные маршруты][Информация] Нет общих планет между столицей ("${capitalId}") и провинцией "${destinationId}" для транспорта "${transportTypeDesc}".`);
                return; // Переходим к следующей итерации
              }

              // Устанавливаем фильтр планет для типов транспорта, требующих маршруты на одной планете
              planetFilter = commonPlanets;
            }

            if (transportType === 'space') {
              // Для типа 'space' маршрут всегда прямой
              routes.push([capitalId, destinationId]);
            } else if (transportType === 'air' || transportType === 'land') {
              // Для типов 'air' и 'land' используем существующую логику маршрутов
              routes = findAllRoutes(
                capitalId,
                destinationId,
                allowedProvincesForTransportType,
                transportType,
                planetFilter,
                allowedLandscapesForTransport,
                false // Не требуем наличие морских провинций
              );
            } else if (transportType === 'water') {
              // Используем обновленную функцию поиска маршрутов для 'water'
              routes = findAllMarineRoutes(
                capitalId,
                destinationId,
                allowedProvincesForTransportType,
                transportType,
                provincesMap
              );
            }

            if (routes.length === 0) {
              const transportTypeDesc = transportTypeDescriptions[transportType] || transportType;
              const resourceCategoryDesc = resourceCategoryDescriptions[resource] || resource;
              messages.push(`[Транспортные маршруты][Информация] Нет доступных маршрутов от столицы ("${capitalId}") до провинции "${destinationId}" для транспорта "${transportTypeDesc}" и категории ресурсов "${resourceCategoryDesc}".`);
              return; // Переходим к следующей итерации
            }

            // Определение оптимального маршрута
            let optimalRoute = null;
            let maxMinValue = -Infinity;

            routes.forEach(route => {
              let minValue = Infinity;
              route.forEach(provinceId => {
                const transport = transportInfrastructureMap[provinceId];
                if (transport && transport.types) {
                  const typeObj = transport.types.find(t => t.type === transportType);
                  if (typeObj && typeof typeObj.capacity[resource] === 'number') {
                    // Для 'water' учитываем только прибережные провинции при вычислении minValue
                    if (transportType === 'water') {
                      const province = provincesMap[provinceId];
                      if (isCoastalProvince(province)) {
                        if (typeObj.capacity[resource] < minValue) {
                          minValue = typeObj.capacity[resource];
                        }
                      }
                    } else {
                      if (typeObj.capacity[resource] < minValue) {
                        minValue = typeObj.capacity[resource];
                      }
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

              // Для 'water', если minValue осталось Infinity (т.е. не было прибережных провинций), устанавливаем 0
              if (transportType === 'water' && minValue === Infinity) {
                minValue = 0;
              }

              if (minValue > maxMinValue) {
                maxMinValue = minValue;
                optimalRoute = route;
              }
            });

            if (optimalRoute) {
              // Получаем описательные названия
              const transportTypeDesc = transportTypeDescriptions[transportType] || transportType;
              const resourceCategoryDesc = resourceCategoryDescriptions[resource] || resource;

              // Установка available.transportType.resource в минимальное значение маршрута для destinationId
              const destinationTransport = transportInfrastructureMap[destinationId];
              if (destinationTransport && destinationTransport.types) {
                const typeObj = destinationTransport.types.find(t => t.type === transportType);
                if (typeObj && typeObj.available && typeof typeObj.available[resource] === 'number') {
                  if (transportType === 'water') {
                    // Для 'water' устанавливаем available на основе maxMinValue, который учитывает только прибережные провинции
                    typeObj.available[resource] = maxMinValue; // Заменяем вместо Math.min
                  } else {
                    typeObj.available[resource] = Math.min(typeObj.available[resource], maxMinValue);
                  }
                  messages.push(`[Транспортные маршруты][Пропускная способность] Для провинции "${destinationId}" тип транспорта "${transportTypeDesc}" в категории ресурсов "${resourceCategoryDesc}" установлено значение доступности: ${typeObj.available[resource]} на основе маршрута "${optimalRoute.join(' -> ')}".`);
                } else {
                  messages.push(`[Ошибка][updateResourcesAvailable] Провинция "${destinationId}" не содержит ключей "${transportType}" или "available.${resource}" в transport_infrastructure.`);
                }
              } else {
                messages.push(`[Ошибка][updateResourcesAvailable] Провинция "${destinationId}" не содержит "transport_infrastructure".`);
              }
            } else {
              const transportTypeDesc = transportTypeDescriptions[transportType] || transportType;
              const resourceCategoryDesc = resourceCategoryDescriptions[resource] || resource;
              messages.push(`[Транспортные маршруты][Информация] Не найден оптимальный маршрут для провинции "${destinationId}", категории ресурсов "${resourceCategoryDesc}" и транспорта "${transportTypeDesc}".`);
            }
          });
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
            // Обновляем transport_infrastructure только для собственных провинций
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
