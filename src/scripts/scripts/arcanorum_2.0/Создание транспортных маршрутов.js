/**
 * Функция обновления доступности ресурсов (available) в каждой провинции нашего государства,
 * учитывая мультимаршрутность (land, water, air, space) и различные условия (прибрежность, планеты, дружелюбие).
 *
 * После вычисления (bottleneck path для каждого ресурса) результат записывается
 * в `province.transport_infrastructure.types[].available[resource]`.
 *
 * @param {Object} data - объект с именованными диапазонами:
 *   - data['Переменные_Основные']
 *   - data['Настройки']
 *   - data['Провинции_ОсновнаяИнформация']
 * @param {Spreadsheet} spreadsheet - активная таблица (при необходимости)
 * @returns {Array<string>} messages - список строк-сообщений (лог).
 */
function updateResourcesAvailable(data, spreadsheet) {
  let messages = [];

  try {
    //--------------------------------------------------------------------------
    // 1. Извлекаем данные из "Переменные_Основные"
    //--------------------------------------------------------------------------
    const varsData = data['Переменные_Основные'];
    if (!varsData || varsData.length < 5) {
      messages.push(`[Ошибка] Переменные_Основные должны иметь минимум 5 строк (state_name, ... [4] для accessible_countries).`);
      return messages;
    }

    let stateName = '';
    let accessibleCountries = [];

    try {
      // Строка 0: JSON вида {"state_name":"Империя"}
      const rawVars = varsData[0][0];
      // Ищем {...} внутри строки
      const parsedVars = JSON.parse(rawVars.match(/\{.*\}/)[0]);
      stateName = (parsedVars.state_name || '').toLowerCase();

      // Строка 4: массив вида ["СтранаА","СтранаБ"]
      const rawAcc = varsData[4][0];
      const parsedAcc = JSON.parse(rawAcc);
      accessibleCountries = parsedAcc.map(x => x.toLowerCase());
    } catch(e) {
      messages.push(`[Ошибка] Не удалось извлечь stateName/accessible_countries: ${e.message}`);
      return messages;
    }

    //--------------------------------------------------------------------------
    // 2. Извлекаем настройки (Настройки): transportTypes, resourceCategories,
    //    coastalLandscapes, allowedLandscapes
    //--------------------------------------------------------------------------
    const settingsData = data['Настройки'];
    if (!settingsData) {
      messages.push(`[Ошибка] Нет данных "Настройки".`);
      return messages;
    }

    let transportTypes = [];
    let resourceCategories = [];
    let allowedLandscapes = {}; // { land:[...], water:[...], ... }
    let coastalLandscapes = [];

    try {
      // (A) "Типы транспорта" - JSON-массив, напр. ["land","water","air","space"]
      const rowTrans = settingsData.find(r => r[0] && r[0].toLowerCase() === 'типы транспорта');
      if (!rowTrans) throw new Error('Нет строки "Типы транспорта"');
      transportTypes = JSON.parse(rowTrans[1]) || [];

      // (B) "Категории товаров" - JSON-массив, напр. ["goods","liquid","gas","energy","service"]
      const rowRes = settingsData.find(r => r[0] && r[0].toLowerCase() === 'категории товаров');
      if (!rowRes) throw new Error('Нет строки "Категории товаров"');
      resourceCategories = JSON.parse(rowRes[1]) || [];

      // (C) "Настройки торговых путей" - JSON-объект, внутри ключ coastal_landscapes
      // например: { "coastal_landscapes":["coast","shore"] }
      const rowTrade = settingsData.find(r => r[0] && r[0].toLowerCase() === 'настройки торговых путей');
      if (!rowTrade) throw new Error('Нет строки "Настройки торговых путей"');
      const tradeObj = JSON.parse(rowTrade[1]);
      coastalLandscapes = (tradeObj.coastal_landscapes || []).map(x => x.toLowerCase());

      // (D) "Ландшафты маршрутов" - JSON-объект, напр. { land:["plain","forest"], water:[], air:[], space:[] }
      const rowLands = settingsData.find(r => r[0] && r[0].toLowerCase() === 'ландшафты маршрутов');
      if (!rowLands) throw new Error('Нет строки "Ландшафты маршрутов"');
      allowedLandscapes = JSON.parse(rowLands[1]) || {};
      Object.keys(allowedLandscapes).forEach(k => {
        if (Array.isArray(allowedLandscapes[k])) {
          allowedLandscapes[k] = allowedLandscapes[k].map(x=>x.toLowerCase());
        }
      });
    } catch(e) {
      messages.push(`[Ошибка] Ошибка при парсинге Настроек: ${e.message}`);
      return messages;
    }

    //--------------------------------------------------------------------------
    // 3. Парсим "Провинции_ОсновнаяИнформация"
    //--------------------------------------------------------------------------
    const provData = data['Провинции_ОсновнаяИнформация'];
    if (!provData) {
      messages.push(`[Ошибка] Нет данных "Провинции_ОсновнаяИнформация".`);
      return messages;
    }

    const provincesMap = {};
    const stateProvinces = [];
    const otherProvinces = [];

    try {
      provData.forEach((row,rowIndex) => {
        const cell = row[0];
        if (!cell) return;
        let js = cell;

        // Убираем внешние кавычки, если есть
        if (js.startsWith('"') && js.endsWith('"')) {
          js = js.slice(1,-1);
        }
        // Заменяем "" на "
        js = js.replace(/""/g,'"');

        const pObj = JSON.parse(js);
        if (!pObj.id) throw new Error(`Нет поля "id" (строка ${rowIndex+1})`);

        // Нормализуем landscapes
        if (!Array.isArray(pObj.landscapes)) {
          pObj.landscapes = [];
        } else {
          pObj.landscapes = pObj.landscapes.map(l=>l.toLowerCase());
        }
        // Neighbors
        if (!Array.isArray(pObj.neighbors)) {
          pObj.neighbors = [];
        }
        // Planet
        if (!Array.isArray(pObj.planet)) {
          pObj.planet = [];
        } else {
          pObj.planet = pObj.planet.map(x=>x.toLowerCase());
        }
        // transport_infrastructure
        if (!pObj.transport_infrastructure) {
          // создадим пустое
          pObj.transport_infrastructure = {
            types: transportTypes.map(tType => ({
              type: tType,
              capacity: resourceCategories.reduce((acc,r)=>{acc[r]=0;return acc;},{}),
              available: resourceCategories.reduce((acc,r)=>{acc[r]=0;return acc;},{}),
            }))
          };
        }

        // Сохраняем
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

    // Список доступных чужих
    const allowedOtherProvinces = otherProvinces.filter(pid => {
      const ow = (provincesMap[pid].owner||'').toLowerCase();
      return accessibleCountries.includes(ow);
    });

    //--------------------------------------------------------------------------
    // 4. Ищем столицу (предполагаем, что она одна)
    //--------------------------------------------------------------------------
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

    //--------------------------------------------------------------------------
    // 5. Вспомогательные функции
    //--------------------------------------------------------------------------
    // 5A) Проверка ландшафта
    function hasAllowedLandscapeForTransport(pv, tType) {
      if (!allowedLandscapes[tType] || allowedLandscapes[tType].length===0) {
        // нет ограничений
        return true;
      }
      // Ищем пересечение landscapes провинции с allowedLandscapes[tType]
      return pv.landscapes.some(l => allowedLandscapes[tType].includes(l));
    }
    // 5B) Проверка, coastal ли провинция
    function isCoastal(pv) {
      return pv.landscapes.some(l=> coastalLandscapes.includes(l));
    }
    // 5C) sharePlanet
    function sharePlanet(pidA, pidB) {
      const pA = provincesMap[pidA], pB = provincesMap[pidB];
      if (!pA || !pB) return false;
      return pA.planet.some(pl => pB.planet.includes(pl));
    }
    // 5D) getCapacity
    function getCapacity(pid, tType, resource) {
      const pv = provincesMap[pid];
      if (!pv || !pv.transport_infrastructure) return 0;
      const tObj = pv.transport_infrastructure.types.find(x=> x.type===tType);
      if (!tObj) return 0;
      return tObj.capacity[resource]||0;
    }
    // 5E) Словарь для русских названий транспорта
    const transportTypeDescriptions = {
      land: "🚚",
      water: "🛥️",
      air: "🛫",
      space: "🚀"
    };

    //--------------------------------------------------------------------------
    // 6. Строим layer-граф для одного ресурса
    //--------------------------------------------------------------------------
    function buildLayeredGraphForResource(resource) {
      const graph = {
        vertices: {},
        edges: {}
      };

      // friendlySet = наши + доступные
      const friendlySet = new Set([...stateProvinces, ...allowedOtherProvinces]);

      // (A) Создаём вершины (pId-transport), если capacity>0 и ландшафт ок
      transportTypes.forEach(tType => {
        friendlySet.forEach(pid => {
          const pv = provincesMap[pid];
          if (!hasAllowedLandscapeForTransport(pv, tType)) return;
          const cVal = getCapacity(pid, tType, resource);
          if (cVal>0) {
            const key = `${pid}-${tType}`;
            graph.vertices[key] = { pId: pid, transport: tType };
            graph.edges[key] = [];
          }
        });
      });

      // (B) Вертикальные рёбра (пересадка)
      Object.keys(graph.vertices).forEach(vKey => {
        const { pId, transport } = graph.vertices[vKey];
        const capA = getCapacity(pId, transport, resource);
        transportTypes.forEach(otherT => {
          if (otherT===transport) return;
          const otherKey = `${pId}-${otherT}`;
          if (graph.vertices[otherKey]) {
            const capB = getCapacity(pId, otherT, resource);
            const mm = Math.min(capA, capB);
            graph.edges[vKey].push({ to: otherKey, capacity: mm });
            graph.edges[otherKey].push({ to: vKey, capacity: mm });
          }
        });
      });

      // (C) Горизонтальные рёбра
      //  land: по neighbors (и sharePlanet)
      //  water: пары coastal + sharePlanet
      //  air: пары на одной планете
      //  space: пары без планеты

      // --- land ---
      friendlySet.forEach(pid => {
        const landKey = `${pid}-land`;
        if (!graph.vertices[landKey]) return;
        const pv = provincesMap[pid];
        pv.neighbors.forEach(nId => {
          const neighKey = `${nId}-land`;
          if (!graph.vertices[neighKey]) return;
          if (!sharePlanet(pid,nId)) return;
          const cA = getCapacity(pid,'land',resource);
          const cB = getCapacity(nId,'land',resource);
          const mm = Math.min(cA,cB);
          if (mm>0) {
            graph.edges[landKey].push({ to: neighKey, capacity:mm });
            graph.edges[neighKey].push({ to: landKey, capacity:mm });
          }
        });
      });

      // --- water ---
      const waterVerts = Object.keys(graph.vertices).filter(k=>k.endsWith('-water'));
      for (let i=0; i<waterVerts.length; i++){
        for (let j=i+1; j<waterVerts.length; j++){
          const vA = waterVerts[i], vB = waterVerts[j];
          const { pId:pA } = graph.vertices[vA];
          const { pId:pB } = graph.vertices[vB];
          if (!sharePlanet(pA,pB)) continue;
          if (!isCoastal(provincesMap[pA])) continue;
          if (!isCoastal(provincesMap[pB])) continue;
          const cA = getCapacity(pA,'water',resource);
          const cB = getCapacity(pB,'water',resource);
          const mm = Math.min(cA,cB);
          if (mm>0) {
            graph.edges[vA].push({ to: vB, capacity:mm });
            graph.edges[vB].push({ to: vA, capacity:mm });
          }
        }
      }

      // --- air ---
      const airVerts = Object.keys(graph.vertices).filter(k=>k.endsWith('-air'));
      for (let i=0; i<airVerts.length; i++){
        for (let j=i+1; j<airVerts.length; j++){
          const vA = airVerts[i], vB = airVerts[j];
          const { pId:pA } = graph.vertices[vA];
          const { pId:pB } = graph.vertices[vB];
          if (!sharePlanet(pA,pB)) continue;
          const cA = getCapacity(pA,'air',resource);
          const cB = getCapacity(pB,'air',resource);
          const mm = Math.min(cA,cB);
          if (mm>0) {
            graph.edges[vA].push({ to: vB, capacity:mm });
            graph.edges[vB].push({ to: vA, capacity:mm });
          }
        }
      }

      // --- space ---
      const spaceVerts = Object.keys(graph.vertices).filter(k=>k.endsWith('-space'));
      for (let i=0; i<spaceVerts.length; i++){
        for (let j=i+1; j<spaceVerts.length; j++){
          const vA = spaceVerts[i], vB = spaceVerts[j];
          const { pId:pA } = graph.vertices[vA];
          const { pId:pB } = graph.vertices[vB];
          const cA = getCapacity(pA,'space',resource);
          const cB = getCapacity(pB,'space',resource);
          const mm = Math.min(cA,cB);
          if (mm>0) {
            graph.edges[vA].push({ to: vB, capacity:mm });
            graph.edges[vB].push({ to: vA, capacity:mm });
          }
        }
      }

      return graph;
    }

    //--------------------------------------------------------------------------
    // 7. Поиск bottleneck (max-min) + восстановление пути с указанием транспорта на русском
    //--------------------------------------------------------------------------
    function findMaxBottleneckPath(layeredGraph, startPId, endPId) {
      // Собираем стартовые/конечные вершины
      const startKeys = [];
      const endKeys = new Set();
      for (const vKey in layeredGraph.vertices) {
        const v = layeredGraph.vertices[vKey];
        if (v.pId === startPId) startKeys.push(vKey);
        if (v.pId === endPId) endKeys.add(vKey);
      }
      if (startKeys.length===0 || endKeys.size===0) {
        return { bottleneck:0, path:[] };
      }

      // dist[vKey] - лучший (максимальный) bottleneck от старта
      const dist = {};
      const prev = {};
      Object.keys(layeredGraph.vertices).forEach(k => {
        dist[k] = 0;
        prev[k] = null;
      });

      let queue = [];
      // инициализация
      startKeys.forEach(sk => {
        dist[sk] = Infinity;
        queue.push(sk);
      });
      queue.sort((a,b)=> dist[b] - dist[a]);

      while(queue.length>0) {
        const current = queue.shift();
        const curVal = dist[current];
        if (endKeys.has(current)) {
          // восстановим маршрут
          const pathArr = restorePath(current);
          return { bottleneck: curVal, path: pathArr };
        }
        const edgesList = layeredGraph.edges[current] || [];
        for (const edge of edgesList) {
          const cand = Math.min(curVal, edge.capacity);
          if (cand > dist[edge.to]) {
            dist[edge.to] = cand;
            prev[edge.to] = current;
            queue.push(edge.to);
          }
        }
        queue.sort((a,b)=> dist[b] - dist[a]);
      }

      return { bottleneck:0, path:[] };

      // восстановление пути, указываем (провинция(русское_название_транспорта))
      function restorePath(endV) {
        const arr = [];
        let c = endV;
        while (c) {
          arr.push(c);
          c = prev[c];
        }
        arr.reverse();
        return arr.map(k => {
          const vObj = layeredGraph.vertices[k];
          if (!vObj) return k;
          const rus = transportTypeDescriptions[vObj.transport] || vObj.transport;
          return `${vObj.pId}(${rus})`;
        });
      }
    }

    //--------------------------------------------------------------------------
    // 8. Обнуляем available[..] прежде чем пересчитывать
    //--------------------------------------------------------------------------
    stateProvinces.forEach(pid => {
      const pv = provincesMap[pid];
      pv.transport_infrastructure.types.forEach(tObj => {
        resourceCategories.forEach(r => {
          tObj.available[r] = 0;
        });
      });
    });

    //--------------------------------------------------------------------------
    // 9. Для каждого ресурса -> строим граф -> ищем путь (pId->capitalId) -> записываем
    //--------------------------------------------------------------------------
    resourceCategories.forEach(resource => {
      const layeredGraph = buildLayeredGraphForResource(resource);

      stateProvinces.forEach(pId => {
        if (pId===capitalId) return; // пропускаем столицу
        const { bottleneck, path } = findMaxBottleneckPath(layeredGraph, pId, capitalId);
        if (bottleneck>0) {
          // записываем
          const pv = provincesMap[pId];
          pv.transport_infrastructure.types.forEach(tObj => {
            if (transportTypes.includes(tObj.type)) {
              // Можно заменить на = bottleneck, или max(...)
              tObj.available[resource] = Math.max(tObj.available[resource], bottleneck);
            }
          });
          // Выводим маршрут
          messages.push(`[${resource}] 🗾 Провинция ${pId} может транспортировать: 📦${bottleneck} единиц продукции, маршрут: ${path.join('🢂')}`);
        } else {
          messages.push(`[${resource}] 🗾 Нет пути от провинции=${pId} до столицы=${capitalId}`);
        }
      });
    });

    //--------------------------------------------------------------------------
    // 10. Сохраняем обратно в data['Провинции_ОсновнаяИнформация']
    //--------------------------------------------------------------------------
    const updatedProvs = provData.map((row,rowIndex) => {
      const cell = row[0];
      if (!cell) return row;
      try {
        let js = cell;
        if (js.startsWith('"') && js.endsWith('"')) {
          js = js.slice(1,-1);
        }
        js = js.replace(/""/g,'"');
        const pObj = JSON.parse(js);
        if (pObj.id && provincesMap[pObj.id]) {
          pObj.transport_infrastructure = provincesMap[pObj.id].transport_infrastructure;
          return [JSON.stringify(pObj)];
        }
      } catch(e) {
        messages.push(`[Ошибка][Сохранение] Строка=${rowIndex+1}: ${e.message}`);
      }
      return row;
    });
    data['Провинции_ОсновнаяИнформация'] = updatedProvs;

  } catch(e) {
    messages.push(`[Ошибка][updateResourcesAvailable] ${e.message}`);
  }

  return messages;
}
