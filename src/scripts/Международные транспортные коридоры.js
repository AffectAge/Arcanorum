/**
 * Функция для обновления маршрутов к столицам стран из торговых договоров.
 * Использует ту же логику построения маршрутов (граф, вычисление макс. потока) 
 * что и в updateResourcesAvailable, но записывает available в данные торговых партнёров.
 *
 * @param {Object} data - Объект с данными из именованных диапазонов:
 *   - data['Переменные']
 *   - data['Настройки']
 *   - data['Провинции_ОсновнаяИнформация']
 *   - data['Торговые_Партнёры']
 * @param {Spreadsheet} spreadsheet - активная таблица (при необходимости)
 * @returns {Array<string>} messages - массив лог-сообщений.
 */
function updateTradeRoutesToPartners(data, spreadsheet) {
  let messages = [];
  try {
    // 1. Извлечение переменных
    const varsData = data['Переменные'];
    if (!varsData || varsData.length < 1) {
      messages.push('[Ошибка] Нет данных в "Переменные".');
      return messages;
    }
    
    // Извлекаем название нашего государства
    let stateName = '';
    try {
      const stateRow = varsData.find(row => row[0] === 'Основные данные государства');
      if (stateRow && stateRow[1]) {
        const jsonMatch = stateRow[1].match(/\{.*\}/);
        if (jsonMatch) {
          const variablesJson = JSON.parse(jsonMatch[0]);
          stateName = (variablesJson.state_name || '').toLowerCase();
          if (!stateName) throw new Error('Ключ "state_name" отсутствует или пуст.');
        } else {
          throw new Error('Не удалось извлечь JSON из "Основные данные государства".');
        }
      } else {
        throw new Error('Идентификатор "Основные данные государства" не найден.');
      }
    } catch (e) {
      messages.push(`[Ошибка] ${e.message}`);
      return messages;
    }
    messages.push(`[INFO] Наше государство: ${stateName}`);
    
    // Извлекаем торговые договоры из переменной "Торговые договоры"
    let tradeAgreements = [];
    try {
      const tradeRow = varsData.find(row => row[0] === 'Торговые договоры');
      if (tradeRow && tradeRow[1]) {
        tradeAgreements = JSON.parse(tradeRow[1]);
        if (!Array.isArray(tradeAgreements)) {
          throw new Error('Торговые договоры должны быть массивом.');
        }
      } else {
        throw new Error('Идентификатор "Торговые договоры" не найден или пуст.');
      }
    } catch(e) {
      messages.push(`[Ошибка] ${e.message}`);
      return messages;
    }
    messages.push(`[INFO] Найдено торговых договоров: ${tradeAgreements.length}`);
    
    // 2. Извлечение настроек
    const settingsData = data['Настройки'];
    if (!settingsData) {
      messages.push('[Ошибка] Нет данных "Настройки".');
      return messages;
    }
    
    let transportTypes = [];
    let resourceCategories = [];
    let allowedLandscapes = {};
    let coastalLandscapes = [];
    let seaRoutesLandscapes = [];
    try {
      const rowTrans = settingsData.find(r => r[0] && r[0].toLowerCase() === 'типы транспорта');
      if (!rowTrans) throw new Error('Нет строки "Типы транспорта"');
      transportTypes = JSON.parse(rowTrans[1]) || [];
      
      const rowRes = settingsData.find(r => r[0] && r[0].toLowerCase() === 'категории товаров');
      if (!rowRes) throw new Error('Нет строки "Категории товаров"');
      resourceCategories = JSON.parse(rowRes[1]) || [];
      
      const rowTrade = settingsData.find(r => r[0] && r[0].toLowerCase() === 'настройки торговых путей');
      if (!rowTrade) throw new Error('Нет строки "Настройки торговых путей"');
      const tradeObj = JSON.parse(rowTrade[1]);
      coastalLandscapes = (tradeObj.coastal_landscapes || []).map(x => x.toLowerCase());
      seaRoutesLandscapes = (tradeObj.sea_routes_landscapes || []).map(x => x.toLowerCase());
      
      const rowLands = settingsData.find(r => r[0] && r[0].toLowerCase() === 'ландшафты маршрутов');
      if (!rowLands) throw new Error('Нет строки "Ландшафты маршрутов"');
      allowedLandscapes = JSON.parse(rowLands[1]) || {};
      Object.keys(allowedLandscapes).forEach(k => {
        if (Array.isArray(allowedLandscapes[k])) {
          allowedLandscapes[k] = allowedLandscapes[k].map(x => x.toLowerCase());
        }
      });
    } catch(e) {
      messages.push(`[Ошибка] При парсинге Настроек: ${e.message}`);
      return messages;
    }
    
    // 3. Парсинг провинций
    const provData = data['Провинции_ОсновнаяИнформация'];
    if (!provData) {
      messages.push('[Ошибка] Нет данных "Провинции_ОсновнаяИнформация".');
      return messages;
    }
    const provincesMap = {};
    const stateProvinces = []; // наши провинции (owner === stateName)
    // Для иностранных провинций создаём мапу: ключ – название страны (в нижнем регистре), значение – массив id провинций
    const foreignProvincesMap = {};
    try {
      provData.forEach((row, rowIndex) => {
        let cell = row[0];
        if (!cell) return;
        let js = cell;
        if (js.startsWith('"') && js.endsWith('"')) {
          js = js.slice(1, -1);
        }
        js = js.replace(/""/g, '"');
        const pObj = JSON.parse(js);
        if (!pObj.id) throw new Error(`Нет поля "id" (строка ${rowIndex + 1})`);
        // Приводим landscapes и planet к нижнему регистру
        if (!Array.isArray(pObj.landscapes)) {
          pObj.landscapes = [];
        } else {
          pObj.landscapes = pObj.landscapes.map(l => l.toLowerCase());
        }
        if (!Array.isArray(pObj.neighbors)) {
          pObj.neighbors = [];
        }
        if (!Array.isArray(pObj.planet)) {
          pObj.planet = [];
        } else {
          pObj.planet = pObj.planet.map(x => x.toLowerCase());
        }
        // Если отсутствует транспортная инфраструктура – создаём её
        if (!pObj.transport_infrastructure) {
          pObj.transport_infrastructure = {
            types: transportTypes.map(tType => ({
              type: tType,
              capacity: resourceCategories.reduce((acc, r) => { acc[r] = 0; return acc; }, {}),
              available: resourceCategories.reduce((acc, r) => { acc[r] = 0; return acc; }, {})
            }))
          };
        }
        provincesMap[pObj.id] = pObj;
        const ownerLow = (pObj.owner || '').toLowerCase();
        if (ownerLow === stateName) {
          stateProvinces.push(pObj.id);
        } else {
          if (!foreignProvincesMap[ownerLow]) {
            foreignProvincesMap[ownerLow] = [];
          }
          foreignProvincesMap[ownerLow].push(pObj.id);
        }
      });
    } catch(e) {
      messages.push(`[Ошибка] При парсинге провинций: ${e.message}`);
      return messages;
    }
    messages.push(`[INFO] Наших провинций: ${stateProvinces.length}`);
    
    // 4. Подготовка данных торговых партнёров
    let tradePartners = [];
    if (data['Торговые_Партнёры'] && data['Торговые_Партнёры'].length > 0) {
      data['Торговые_Партнёры'].forEach((row, rowIndex) => {
        const cell = row[0];
        if (!cell || cell.trim() === "") return;
        try {
          const arr = JSON.parse(cell);
          if (Array.isArray(arr)) {
            tradePartners = tradePartners.concat(arr);
          }
        } catch (err) {
          messages.push(`[Ошибка] Парсинг торговых партнёров в строке ${rowIndex + 1}: ${err.message}`);
        }
      });
    }
    // Приводим tradePartners к мапе по названию страны (ключ в нижнем регистре)
    const tradePartnersMap = {};
    tradePartners.forEach(partner => {
      if (partner.country) {
        tradePartnersMap[partner.country.toLowerCase()] = partner;
      }
    });
    
    // 5. Определяем иностранную столицу для каждой торговой страны из договоров.
    // Для каждой страны из торговых договоров берём провинции из foreignProvincesMap и ищем ту, где is_capital === true.
    const foreignCapitals = {}; // ключ: страна, значение: id провинции-столицы
    tradeAgreements.forEach(ta => {
      const countryName = (ta.country || '').toLowerCase();
      const foreignProvIds = foreignProvincesMap[countryName];
      if (!foreignProvIds || foreignProvIds.length === 0) {
        messages.push(`[Предупреждение] Нет провинций для страны "${ta.country}"`);
        return;
      }
      let capId = null;
      for (const pid of foreignProvIds) {
        const p = provincesMap[pid];
        if (p && p.is_capital === true) {
          capId = pid;
          break;
        }
      }
      if (!capId) {
        messages.push(`[Предупреждение] Для страны "${ta.country}" не найдена столица (is_capital=true)`);
      } else {
        foreignCapitals[countryName] = capId;
      }
    });
    
    // 6. Вспомогательные функции, общие для расчёта маршрутов
    
    function hasAllowedLandscapeForTransport(pv, tType) {
      if (!allowedLandscapes[tType] || allowedLandscapes[tType].length === 0) {
        return true;
      }
      return pv.landscapes.some(l => allowedLandscapes[tType].includes(l));
    }
    
    function isCoastal(pv) {
      return pv.landscapes.some(l => coastalLandscapes.includes(l));
    }
    
    function sharePlanet(pidA, pidB) {
      const pA = provincesMap[pidA], pB = provincesMap[pidB];
      if (!pA || !pB) return false;
      return pA.planet.some(pl => pB.planet.includes(pl));
    }
    
    function getCapacity(pid, tType, resource) {
      const pv = provincesMap[pid];
      if (!pv || !pv.transport_infrastructure) return 0;
      const tObj = pv.transport_infrastructure.types.find(x => x.type === tType);
      if (!tObj) return 0;
      return tObj.capacity[resource] || 0;
    }
    
    // Функция вычисления максимального потока (алгоритм Эдмондса–Карпа)
    function computeMaxFlow(graph, startKeys, endKeys) {
      const residual = {};
      Object.keys(graph.vertices).forEach(vKey => {
        residual[vKey] = {};
        (graph.edges[vKey] || []).forEach(edge => {
          if (!residual[vKey][edge.to]) {
            residual[vKey][edge.to] = 0;
          }
          residual[vKey][edge.to] += edge.capacity;
        });
      });
      
      let maxFlow = 0;
      const allAugPaths = [];
      
      function bfs() {
        const parent = {};
        const visited = new Set();
        const queue = [];
        startKeys.forEach(sk => {
          queue.push(sk);
          visited.add(sk);
          parent[sk] = null;
        });
        while (queue.length > 0) {
          const current = queue.shift();
          if (endKeys.has(current)) {
            const path = [];
            let v = current;
            while (v !== null) {
              path.push(v);
              v = parent[v];
            }
            path.reverse();
            return path;
          }
          for (const neighbor in residual[current]) {
            if (!visited.has(neighbor) && residual[current][neighbor] > 0) {
              visited.add(neighbor);
              parent[neighbor] = current;
              queue.push(neighbor);
            }
          }
        }
        return null;
      }
      
      let path;
      while ((path = bfs()) !== null) {
        let pathFlow = Infinity;
        for (let i = 0; i < path.length - 1; i++) {
          const u = path[i], v = path[i+1];
          pathFlow = Math.min(pathFlow, residual[u][v]);
        }
        maxFlow += pathFlow;
        allAugPaths.push({ startKey: path[0], path: path.slice(), flow: pathFlow });
        for (let i = 0; i < path.length - 1; i++) {
          const u = path[i], v = path[i+1];
          residual[u][v] -= pathFlow;
          if (!residual[v]) {
            residual[v] = {};
          }
          if (!residual[v][u]) {
            residual[v][u] = 0;
          }
          residual[v][u] += pathFlow;
        }
      }
      return { flow: maxFlow, augPaths: allAugPaths };
    }
    
    // Функция построения графа для ресурса с учетом заданного friendlySet
    // (friendlySet – объединение наших провинций и провинций иностранного государства)
    function buildLayeredGraphForResource(resource, friendlySet) {
      const graph = { vertices: {}, edges: {} };
      
      // Создаем вершины для каждого транспортного типа
      transportTypes.forEach(tType => {
        friendlySet.forEach(pid => {
          const pv = provincesMap[pid];
          if (!hasAllowedLandscapeForTransport(pv, tType)) return;
          if (tType === 'water') {
            const hasCap = getCapacity(pid, 'water', resource) > 0;
            const isSea = pv.landscapes.some(l => seaRoutesLandscapes.includes(l));
            if (!(hasCap || isSea)) return;
          } else {
            if (getCapacity(pid, tType, resource) <= 0) return;
          }
          const key = `${pid}-${tType}`;
          graph.vertices[key] = { pId: pid, transport: tType };
          graph.edges[key] = [];
        });
      });
      
      // Вертикальные ребра внутри одной провинции (переход между типами)
      Object.keys(graph.vertices).forEach(vKey => {
        const { pId, transport } = graph.vertices[vKey];
        const capA = getCapacity(pId, transport, resource);
        transportTypes.forEach(otherT => {
          if (otherT === transport) return;
          const otherKey = `${pId}-${otherT}`;
          if (graph.vertices[otherKey]) {
            const capB = getCapacity(pId, otherT, resource);
            const mm = Math.min(capA, capB);
            if (mm > 0) {
              graph.edges[vKey].push({ to: otherKey, capacity: mm });
              graph.edges[otherKey].push({ to: vKey, capacity: mm });
            }
          }
        });
      });
      
      // Горизонтальные ребра для типа "land"
      friendlySet.forEach(pid => {
        const landKey = `${pid}-land`;
        if (!graph.vertices[landKey]) return;
        const pv = provincesMap[pid];
        pv.neighbors.forEach(nId => {
          const neighKey = `${nId}-land`;
          if (!graph.vertices[neighKey]) return;
          if (!sharePlanet(pid, nId)) return;
          const cA = getCapacity(pid, 'land', resource);
          const cB = getCapacity(nId, 'land', resource);
          const mm = Math.min(cA, cB);
          if (mm > 0) {
            graph.edges[landKey].push({ to: neighKey, capacity: mm });
            graph.edges[neighKey].push({ to: landKey, capacity: mm });
          }
        });
      });
      
      // Горизонтальные ребра для типа "water"
      function effectiveWaterCapacity(pid) {
        const pv = provincesMap[pid];
        if (isCoastal(pv)) {
          return getCapacity(pid, 'water', resource);
        } else if (pv.landscapes.some(l => seaRoutesLandscapes.includes(l))) {
          return Infinity;
        }
        return 0;
      }
      const waterVerts = Object.keys(graph.vertices).filter(k => k.endsWith('-water'));
      waterVerts.forEach(vKey => {
        const { pId } = graph.vertices[vKey];
        const pv = provincesMap[pId];
        if (!pv.neighbors || !Array.isArray(pv.neighbors)) return;
        pv.neighbors.forEach(nId => {
          const neighborKey = `${nId}-water`;
          if (!graph.vertices[neighborKey]) return;
          if (!sharePlanet(pId, nId)) return;
          const capA = effectiveWaterCapacity(pId);
          const capB = effectiveWaterCapacity(nId);
          const mm = Math.min(capA, capB);
          if (mm > 0) {
            graph.edges[vKey].push({ to: neighborKey, capacity: mm });
            graph.edges[neighborKey].push({ to: vKey, capacity: mm });
          }
        });
      });
      
      // Горизонтальные ребра для типа "air"
      const airVerts = Object.keys(graph.vertices).filter(k => k.endsWith('-air'));
      for (let i = 0; i < airVerts.length; i++) {
        for (let j = i + 1; j < airVerts.length; j++) {
          const vA = airVerts[i], vB = airVerts[j];
          const { pId: pA } = graph.vertices[vA];
          const { pId: pB } = graph.vertices[vB];
          if (!sharePlanet(pA, pB)) continue;
          const cA = getCapacity(pA, 'air', resource);
          const cB = getCapacity(pB, 'air', resource);
          const mm = Math.min(cA, cB);
          if (mm > 0) {
            graph.edges[vA].push({ to: vB, capacity: mm });
            graph.edges[vB].push({ to: vA, capacity: mm });
          }
        }
      }
      
      // Горизонтальные ребра для типа "space"
      const spaceVerts = Object.keys(graph.vertices).filter(k => k.endsWith('-space'));
      for (let i = 0; i < spaceVerts.length; i++) {
        for (let j = i + 1; j < spaceVerts.length; j++) {
          const vA = spaceVerts[i], vB = spaceVerts[j];
          const { pId: pA } = graph.vertices[vA];
          const { pId: pB } = graph.vertices[vB];
          const cA = getCapacity(pA, 'space', resource);
          const cB = getCapacity(pB, 'space', resource);
          const mm = Math.min(cA, cB);
          if (mm > 0) {
            graph.edges[vA].push({ to: vB, capacity: mm });
            graph.edges[vB].push({ to: vA, capacity: mm });
          }
        }
      }
      
      return graph;
    }
    
    // 7. Вычисление маршрутов и суммирование потока для каждой торговой страны и каждого ресурса
    tradeAgreements.forEach(ta => {
      const countryName = (ta.country || '').toLowerCase();
      const foreignProvIds = foreignProvincesMap[countryName];
      const capId = foreignCapitals[countryName];
      if (!foreignProvIds || !capId) {
        messages.push(`[Пропуск] Нет данных для страны "${ta.country}" (отсутствуют провинции или столица).`);
        return;
      }
      
      resourceCategories.forEach(resource => {
        let sumFlow = 0;
        // Формируем friendly set: наши провинции + иностранные провинции для данной страны
        const friendlySet = new Set([...stateProvinces, ...foreignProvIds]);
        // Строим граф для данного ресурса
        const layeredGraph = buildLayeredGraphForResource(resource, friendlySet);
        
        // Для каждой нашей провинции вычисляем поток до иностранной столицы
        stateProvinces.forEach(pId => {
          // Определяем стартовые вершины для нашей провинции
          const startKeys = [];
          for (const vKey in layeredGraph.vertices) {
            const v = layeredGraph.vertices[vKey];
            if (v.pId === pId) startKeys.push(vKey);
          }
          // Определяем конечные вершины для иностранной столицы
          const endKeys = new Set();
          for (const vKey in layeredGraph.vertices) {
            const v = layeredGraph.vertices[vKey];
            if (v.pId === capId) endKeys.add(vKey);
          }
          if (startKeys.length === 0 || endKeys.size === 0) return;
          
          const { flow, augPaths } = computeMaxFlow(layeredGraph, startKeys, endKeys);
          if (flow > 0) {
            sumFlow += flow;
            messages.push(`[Маршрут][${ta.country}][${resource}] Провинция ${pId} -> Столица ${capId}: поток ${flow} ед.`);
          } else {
            messages.push(`[Маршрут][${ta.country}][${resource}] Нет потока от провинции ${pId} к столице ${capId}`);
          }
        });
        
        if (sumFlow > 0) {
          // Обновляем данные торгового партнёра для данного ресурса
          let partner = tradePartnersMap[countryName];
          if (!partner) {
            partner = {
              country: ta.country,
              total_transport: { available: {} },
              allowed_goods: {}
            };
            tradePartnersMap[countryName] = partner;
          }
          partner.total_transport.available[resource] = (partner.total_transport.available[resource] || 0) + sumFlow;
          messages.push(`[Обновление][${ta.country}][${resource}] Добавлено ${sumFlow} ед. к available`);
        }
      });
    });
    
    // 8. Группировка данных торговых партнёров по 10 стран на ячейку и запись в data['Торговые_Партнёры']
    const updatedPartnersArray = Object.values(tradePartnersMap);
    let chunked = [];
    for (let i = 0; i < updatedPartnersArray.length; i += 10) {
      chunked.push(updatedPartnersArray.slice(i, i + 10));
    }
    
    // Определяем число доступных ячеек: если data['Торговые_Партнёры'] имеет несколько строк, используем их число, иначе - 1000
    let availableCells = 0;
    if (Array.isArray(data['Торговые_Партнёры']) && Array.isArray(data['Торговые_Партнёры'][0]) && data['Торговые_Партнёры'].length > 1) {
      availableCells = data['Торговые_Партнёры'].length;
    } else {
      availableCells = 1000;
    }
    
    if (chunked.length > availableCells) {
      messages.push(`[Предупреждение] Недостаточно ячеек: требуется ${chunked.length}, а имеется ${availableCells}. Лишние данные не будут записаны.`);
      chunked = chunked.slice(0, availableCells);
    }
    
    // Формируем итоговый двумерный массив для записи
    const dataToWrite = [];
    for (let i = 0; i < availableCells; i++) {
      if (i < chunked.length) {
        dataToWrite.push([JSON.stringify(chunked[i])]);
      } else {
        dataToWrite.push([""]);
      }
    }
    
    // Пример записи: если бы использовался API, то:
    // spreadsheet.getSheetByName("Торговые_Партнёры").getRange(1, 1, availableCells, 1).setValues(dataToWrite);
    data['Торговые_Партнёры'] = dataToWrite;
    messages.push(`[INFO] Данные для ${chunked.length} групп (по 10 стран) записаны в data['Торговые_Партнёры'], всего ${availableCells} ячеек.`);
    
  } catch(e) {
    messages.push(`[Ошибка][updateTradeRoutesToPartners] ${e.message}`);
  }
  
  return messages;
}
