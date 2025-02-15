function processBuildingTradeOrders(data) {
  const newMessages = [];
  Logger.log("[INFO] Начало работы processSalesForBuildings");

  try {
    // -------------------------------------------------
    // 0. Загружаем данные
    // -------------------------------------------------
    let stateName;
    try {
      const targetIdentifier = 'Основные данные государства';
      const targetRow = data['Переменные']?.find(row => row[0] === targetIdentifier);

      if (targetRow && targetRow[1]) {
        const jsonMatch = targetRow[1].match(/\{.*\}/);
        if (jsonMatch) {
          const variablesJson = JSON.parse(jsonMatch[0]);
          stateName = variablesJson.state_name;
        } else {
          throw new Error('Не удалось извлечь JSON из ячейки Переменные.');
        }
      } else {
        throw new Error(`Идентификатор "${targetIdentifier}" не найден.`);
      }
    } catch (e) {
      Logger.log(`[ERROR] ${e.message}`);
      return newMessages;
    }
    Logger.log(`[INFO] Государство: ${stateName}`);

    // Загружаем таблицы
    const provincesData = data['Провинции_ОсновнаяИнформация'] || [];
    const marketData = data['Международный_Рынок'] || [];
    const buildingsData = data['Постройки_ОсновнаяИнформация'] || [];

    // Парсим провинции
    const provinceMap = {};
    provincesData.forEach((row) => {
      if (!row[0]) return;
      try {
        const province = JSON.parse(row[0]);
        provinceMap[province.id] = province;
      } catch (err) {
        Logger.log(`[ERROR] Ошибка парсинга провинции: ${err.message}`);
      }
    });

    // Собираем все order_id из trade_orders наших построек
    const ourOrderIds = new Set();
    buildingsData.forEach((buildingRow) => {
      const cell = buildingRow[0];
      if (!cell) return;

      try {
        const buildings = JSON.parse(cell);
        buildings.forEach(building => {
          if (building.building_owner === stateName && building.status === "Активная" && building.trade_orders) {
            building.trade_orders.forEach(orderId => ourOrderIds.add(orderId));
          }
        });
      } catch (err) {
        Logger.log(`[ERROR] Ошибка обработки зданий: ${err.message}`);
      }
    });

    // Удаляем ордера на рынке, которые принадлежат нашей стране, но не найдены в наших trade_orders
    marketData.forEach((marketRow, rowIndex) => {
      let orders = [];
      try {
        orders = JSON.parse(marketRow[0] || "[]");
      } catch (e) {
        return;
      }

      const ordersToKeep = [];
      orders.forEach(order => {
        if (order.country === stateName && !ourOrderIds.has(order.order_id)) {
          newMessages.push(`[🗑️ Удален] Ордер ${order.order_id}: принадлежит нашей стране, но не найден в trade_orders.`);
        } else {
          ordersToKeep.push(order);
        }
      });

      if (orders.length !== ordersToKeep.length) {
        marketRow[0] = JSON.stringify(ordersToKeep);
      }
    });

    // -------------------------------------------------
    // Обрабатываем здания и их ордеры
    // -------------------------------------------------
    buildingsData.forEach((buildingRow, rowIndex) => {
      const cell = buildingRow[0];
      if (!cell) return;

      try {
        const buildings = JSON.parse(cell);
        let updated = false;

        buildings.forEach(building => {
          if (building.building_owner !== stateName || building.status !== "Активная") return;
          if (!building.trade_orders || building.trade_orders.length === 0) return;

          const ordersToRemove = [];
          building.trade_orders.forEach(orderId => {
            let orderFound = false;

            // Поиск ордера на рынке
            for (let mRow = 0; mRow < marketData.length; mRow++) {
              const marketRow = marketData[mRow];
              let orders = [];
              try {
                orders = JSON.parse(marketRow[0] || "[]");
              } catch (e) {
                continue;
              }

              for (let oIdx = 0; oIdx < orders.length; oIdx++) {
                const order = orders[oIdx];
                if (order.order_id !== orderId) continue;

                orderFound = true;
                // Шаг 3: Перенос доходов
                if (order.income > 0) {
                  building.incomes = (building.incomes || 0) + order.income;
                  order.income = 0;
                }

                // Шаг 4: Проверка количества
                if (order.availableQuantity <= 0) {
                  orders.splice(oIdx, 1);
                  ordersToRemove.push(orderId);
                  newMessages.push(`[🗑️ Удален] Ордер ${orderId}: товар закончился.`);
                } else {
                  // Шаг 5: Проверка ходов
                  if (order.turns_left === 0) {
                    // Возврат товара на склад здания
                    if (!building.warehouse[order.name]) {
                      building.warehouse[order.name] = { current_quantity: 0 };
                    }
                    building.warehouse[order.name].current_quantity += order.availableQuantity;
                    orders.splice(oIdx, 1);
                    ordersToRemove.push(orderId);
                    newMessages.push(`[🔄 Возврат] Ордер ${orderId}: товар возвращен на склад.`);
                  } else {
                    order.turns_left--;
                    orders[oIdx] = order;
                    newMessages.push(`[⏳ Ход] Ордер ${orderId}: осталось ${order.turns_left} ходов.`);
                  }
                }

                marketRow[0] = JSON.stringify(orders);
                break;
              }
              if (orderFound) break;
            }

            if (!orderFound) {
              ordersToRemove.push(orderId);
              newMessages.push(`[⚠️ Не найден] Ордер ${orderId} не существует.`);
            }
          });

          // Удаление обработанных ордеров
          building.trade_orders = building.trade_orders.filter(id => !ordersToRemove.includes(id));
          updated = true;
        });

        if (updated) {
          buildingRow[0] = JSON.stringify(buildings);
        }
      } catch (err) {
        Logger.log(`[ERROR] Ошибка обработки зданий: ${err.message}`);
      }
    });

  } catch (error) {
    Logger.log(`[ERROR] ${error.message}`);
  }

  return newMessages;
}