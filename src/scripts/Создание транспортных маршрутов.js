/**
 * Функция обновления доступности ресурсов (available) в каждой провинции нашего государства,
 * с использованием объединённого графа и алгоритма максимального потока (Эдмондса–Карпа),
 * с декомпозицией потока на отдельные маршруты.
 *
 * После вычисления (максимального суммарного потока и маршрутов для каждого ресурса)
 * результат записывается в province.transport_infrastructure.types[].available[resource].
 * В логах выводятся все маршруты, которые используются (по одному для каждого транспортного типа).
 *
 * @param {Object} data - объект с именованными диапазонами:
 *   - data['Переменные']
 *   - data['Настройки']
 *   - data['Провинции_ОсновнаяИнформация']
 * @param {Spreadsheet} spreadsheet - активная таблица (при необходимости)
 * @returns {Array<string>} messages - список строк-сообщений (лог).
 */
function updateResourcesAvailable(data, spreadsheet) {
  let messages = [];
  
  try {
    //---------------------------------------------------------------------------
    // 1. Извлекаем данные из "Переменные"
    //---------------------------------------------------------------------------
    const varsData = data['Переменные'];
    if (!varsData || varsData.length < 5) {
      messages.push(`[Ошибка] Переменные должны иметь минимум 5 строк (state_name, ... [4] для Доступные для транспорта страны).`);
      return messages;
    }

    let stateName = '';
    let accessibleCountries = [];
    try {
      const stateRow = varsData.find(row => row[0] === 'Основные данные государства');
      if (stateRow && stateRow[1]) {
        const jsonMatch = stateRow[1].match(/\{.*\}/);
        if (jsonMatch) {
          const variablesJson = JSON.parse(jsonMatch[0]);
          stateName = (variablesJson.state_name || '').toLowerCase();
          if (!stateName) {
            throw new Error('Ключ "state_name" отсутствует или пуст.');
          }
        } else {
          throw new Error('Не удалось извлечь JSON из содержимого "Основные данные государства".');
        }
      } else {
        throw new Error('Идентификатор "Основные данные государства" не найден в "Переменные".');
      }
      const accCountriesRow = varsData.find(row => row[0].toLowerCase() === 'доступные для транспорта страны');
      if (accCountriesRow && accCountriesRow[1]) {
        const parsedAcc = JSON.parse(accCountriesRow[1]);
        accessibleCountries = Array.isArray(parsedAcc) ? parsedAcc.map(x => x.toLowerCase()) : [];
      } else {
        throw new Error('Идентификатор "Доступные для транспорта страны" не найден или пуст в "Переменные".');
      }
    } catch (e) {
      messages.push(`[Ошибка][updateResourcesAvailable] Ошибка при извлечении stateName или Доступные для транспорта страны: ${e.message}`);
      return messages;
    }
    
    //---------------------------------------------------------------------------
    // 2. Извлекаем настройки (Настройки)
    //---------------------------------------------------------------------------
    const settingsData = data['Настройки'];
    if (!settingsData) {
      messages.push(`[Ошибка] Нет данных "Настройки".`);
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
      messages.push(`[Ошибка] Ошибка при парсинге Настроек: ${e.message}`);
      return messages;
    }
    
    //---------------------------------------------------------------------------
    // 3. Парсим "Провинции_ОсновнаяИнформация"
    //---------------------------------------------------------------------------
    const provData = data['Провинции_ОсновнаяИнформация'];
    if (!provData) {
      messages.push(`[Ошибка] Нет данных "Провинции_ОсновнаяИнформация".`);
      return messages;
    }
    
    const provincesMap = {};
    const stateProvinces = [];
    const otherProvinces = [];
    try {
      provData.forEach((row, rowIndex) => {
        const cell = row[0];
        if (!cell) return;
        let js = cell;
        if (js.startsWith('"') && js.endsWith('"')) {
          js = js.slice(1, -1);
        }
        js = js.replace(/""/g, '"');
        const pObj = JSON.parse(js);
        if (!pObj.id) throw new Error(`Нет поля "id" (строка ${rowIndex + 1})`);
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
          otherProvinces.push(pObj.id);
        }
      });
    } catch(e) {
      messages.push(`[Ошибка] При парсинге провинций: ${e.message}`);
      return messages;
    }
    
    const allowedOtherProvinces = otherProvinces.filter(pid => {
      const ow = (provincesMap[pid].owner || '').toLowerCase();
      return accessibleCountries.includes(ow);
    });
    
    //---------------------------------------------------------------------------
    // 4. Находим столицу (предполагается, что она одна)
    //---------------------------------------------------------------------------
    let capitalId = null;
    for (const pid of stateProvinces) {
      const p = provincesMap[pid];
      if (p.is_capital === true) {
        capitalId = pid;
        break;
      }
    }
    if (!capitalId) {
      messages.push(`[Ошибка] Не найдена столица (is_capital=true) в наших провинциях.`);
      return messages;
    }
    
    //---------------------------------------------------------------------------
    // 5. Вспомогательные функции
    //---------------------------------------------------------------------------
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
    const transportTypeDescriptions = {
      land: "🚚",
      water: "🛥️",
      air: "🛫",
      space: "🚀"
    };
    
    //---------------------------------------------------------------------------
    // 6. Построение объединённого графа для одного ресурса
    //---------------------------------------------------------------------------
    function buildLayeredGraphForResource(resource) {
      const graph = { vertices: {}, edges: {} };
      const friendlySet = new Set([...stateProvinces, ...allowedOtherProvinces]);
      
      // Создаем вершины для каждого типа транспорта
      transportTypes.forEach(tType => {
        friendlySet.forEach(pid => {
          const pv = provincesMap[pid];
          if (!hasAllowedLandscapeForTransport(pv, tType)) return;
          if (tType === 'water') {
            const hasCapacity = getCapacity(pid, 'water', resource) > 0;
            const isSeaRoute = pv.landscapes.some(l => seaRoutesLandscapes.includes(l));
            if (!(hasCapacity || isSeaRoute)) return;
          } else {
            if (getCapacity(pid, tType, resource) <= 0) return;
          }
          const key = `${pid}-${tType}`;
          graph.vertices[key] = { pId: pid, transport: tType };
          graph.edges[key] = [];
        });
      });
      
      // Вертикальные рёбра внутри провинции для перехода между типами
      Object.keys(graph.vertices).forEach(vKey => {
        const { pId, transport } = graph.vertices[vKey];
        const capA = getCapacity(pId, transport, resource);
        transportTypes.forEach(otherT => {
          if (otherT === transport) return;
          const otherKey = `${pId}-${otherT}`;
          if (graph.vertices[otherKey]) {
            const capB = getCapacity(pId, otherT, resource);
            const mm = Math.min(capA, capB);
            graph.edges[vKey].push({ to: otherKey, capacity: mm });
            graph.edges[otherKey].push({ to: vObj => vObj, capacity: mm }); // двусторонняя связь
            // Для корректности используем тот же механизм
            graph.edges[otherKey].push({ to: vKey, capacity: mm });
          }
        });
      });
      
      // Горизонтальные рёбра для каждого типа
      // Land
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
      
      // Water
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
      
      // Air
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
      
      // Space
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
    
    //---------------------------------------------------------------------------
    // 7. Функция вычисления максимального потока с сохранением всех аугментирующих маршрутов
    //---------------------------------------------------------------------------
    function computeMaxFlow(graph, startKeys, endKeys) {
      // Создаем остаточный граф
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
      const allAugPaths = []; // будем сохранять { startKey, path, flow }
      
      // BFS для поиска аугментирующего пути
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
        // Определяем поток по найденному пути
        let pathFlow = Infinity;
        for (let i = 0; i < path.length - 1; i++) {
          const u = path[i], v = path[i+1];
          pathFlow = Math.min(pathFlow, residual[u][v]);
        }
        maxFlow += pathFlow;
        // Сохраняем информацию о маршруте
        allAugPaths.push({ startKey: path[0], path: path.slice(), flow: pathFlow });
        // Обновляем остаточный граф
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
    
    //---------------------------------------------------------------------------
    // 8. Обнуляем available для провинций
    //---------------------------------------------------------------------------
    stateProvinces.forEach(pid => {
      const pv = provincesMap[pid];
      pv.transport_infrastructure.types.forEach(tObj => {
        resourceCategories.forEach(r => {
          tObj.available[r] = 0;
        });
      });
    });
    
    //---------------------------------------------------------------------------
    // 9. Для каждого ресурса строим граф, вычисляем макс. поток и формируем сообщение с маршрутами
    //---------------------------------------------------------------------------
    resourceCategories.forEach(resource => {
      const layeredGraph = buildLayeredGraphForResource(resource);
      
      stateProvinces.forEach(pId => {
        if (pId === capitalId) return;
        const pv = provincesMap[pId];
        if (pv.landscapes.some(l => seaRoutesLandscapes.includes(l))) {
          messages.push(`[${resource}] 🗾 Провинция ${pId} имеет ландшафт sea_routes_landscapes — маршрут к столице не рассчитывается.`);
          return;
        }
        const startKeys = [];
        for (const vKey in layeredGraph.vertices) {
          const v = layeredGraph.vertices[vKey];
          if (v.pId === pId) startKeys.push(vKey);
        }
        const endKeys = new Set();
        for (const vKey in layeredGraph.vertices) {
          const v = layeredGraph.vertices[vKey];
          if (v.pId === capitalId) endKeys.add(vKey);
        }
        const { flow, augPaths } = computeMaxFlow(layeredGraph, startKeys, endKeys);
        if (flow > 0 && augPaths.length > 0) {
          // Группируем найденные маршруты по исходному транспортному типу (из ключа, напр. "P1-land")
          const routesByType = {};
          augPaths.forEach(item => {
            // Извлекаем тип транспорта из стартового ключа (после дефиса)
            const type = item.startKey.split('-')[1];
            if (!routesByType[type] || routesByType[type].flow < item.flow) {
              routesByType[type] = item;
            }
          });
          // Собираем итоговую строку с маршрутами
          const routeStrs = [];
          let sumFlow = 0;
          Object.keys(routesByType).forEach(type => {
            const routeItem = routesByType[type];
            sumFlow += routeItem.flow;
            const routePathStr = routeItem.path.map(k => {
              const vObj = layeredGraph.vertices[k];
              return `${vObj.pId}(${transportTypeDescriptions[vObj.transport] || vObj.transport})`;
            }).join('🢂');
            routeStrs.push(routePathStr + ` (${routeItem.flow} ед.)`);
          });
          
          // Обновляем available по каждому типу (максимум из выбранных маршрутов)
          pv.transport_infrastructure.types.forEach(tObj => {
            if (transportTypes.includes(tObj.type) && routesByType[tObj.type]) {
              tObj.available[resource] = Math.max(tObj.available[resource], routesByType[tObj.type].flow);
            }
          });
          
          messages.push(`[Объединённый граф (${resource})] Провинция ${pId} может транспортировать суммарно: 📦${sumFlow} единиц продукции, маршруты: ${routeStrs.join(' ; ')}`);
        } else {
          messages.push(`[${resource}] 🗾 Нет доступного потока от провинции=${pId} до столицы=${capitalId}`);
        }
      });
    });
    
    //---------------------------------------------------------------------------
    // 10. Сохраняем обновленные данные обратно в data['Провинции_ОсновнаяИнформация']
    //---------------------------------------------------------------------------
    const updatedProvs = provData.map((row, rowIndex) => {
      const cell = row[0];
      if (!cell) return row;
      try {
        let js = cell;
        if (js.startsWith('"') && js.endsWith('"')) {
          js = js.slice(1, -1);
        }
        js = js.replace(/""/g, '"');
        const pObj = JSON.parse(js);
        if (pObj.id && provincesMap[pObj.id]) {
          pObj.transport_infrastructure = provincesMap[pObj.id].transport_infrastructure;
          return [JSON.stringify(pObj)];
        }
      } catch(e) {
        messages.push(`[Ошибка][Сохранение] Строка=${rowIndex + 1}: ${e.message}`);
      }
      return row;
    });
    data['Провинции_ОсновнаяИнформация'] = updatedProvs;
    
  } catch(e) {
    messages.push(`[Ошибка][updateResourcesAvailable] ${e.message}`);
  }
  
  return messages;
}
