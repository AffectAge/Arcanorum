function processBuildingTradeOrders(data) {
  const newMessages = [];
  Logger.log("[INFO] Начало работы processBuildingTradeOrders");

  try {
    // Загружаем данные о государстве
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
    const buildingsData = data['Постройки_ОсновнаяИнформация'] || [];
    const marketData = data['Международный_Рынок'] || [];

    Logger.log(`[INFO] Загружено зданий: ${buildingsData.length}`);
    Logger.log(`[INFO] Загружено строк рынка: ${marketData.length}`);

    // -------------------------------------------------
    // 1. Обрабатываем постройки
    // -------------------------------------------------
    buildingsData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (!cell || cell.trim() === "") return;

      try {
        Logger.log(`[DEBUG] Исходные данные постройки: ${cell}`);

        const buildingsArray = JSON.parse(cell);
        if (!Array.isArray(buildingsArray) || buildingsArray.length === 0) {
          Logger.log(`[ERROR] Данные здания пустые или некорректны`);
          return;
        }

        buildingsArray.forEach((building, bIndex) => {
          if (building.building_owner !== stateName || !Array.isArray(building.trade_orders)) {
            return;
          }

          Logger.log(`[INFO] Обрабатываем торговые объявления для здания: ${building.building_name}`);

          // Проходим по каждому объявлению
          building.trade_orders = building.trade_orders.filter(orderId => {
            let orderFound = false;

            for (let i = 0; i < marketData.length; i++) {
              let orders = JSON.parse(marketData[i][0] || "[]");

              const orderIndex = orders.findIndex(order => order.order_id === orderId);
              if (orderIndex === -1) continue;

              orderFound = true;
              const order = orders[orderIndex];

              // 📥 Переводим доход в постройку
              if (!building.incomes) {
                building.incomes = 0;
              }
              building.incomes += order.income;
              order.income = 0;

              Logger.log(`[SUCCESS] Доход ${order.income} переведен в ${building.building_name}`);

              // 🏛 Проверяем availableQuantity
              if (order.availableQuantity === 0) {
                orders.splice(orderIndex, 1);
                Logger.log(`[INFO] Объявление ${orderId} удалено (товар распродан)`);
                return false;
              }

              // ⏳ Проверяем turns_left
              if (order.turns_left === 0) {
                // Возвращаем товар в постройку
                if (!building.warehouse[order.name]) {
                  building.warehouse[order.name] = { current_quantity: 0, reserve_level: 0 };
                }
                building.warehouse[order.name].current_quantity += order.availableQuantity;

                // Удаляем объявление
                orders.splice(orderIndex, 1);
                Logger.log(`[INFO] Объявление ${orderId} удалено (истек срок размещения), товар возвращен`);
                return false;
              }

              // ⏬ Уменьшаем turns_left
              order.turns_left -= 1;
              Logger.log(`[INFO] Объявление ${orderId}: turns_left уменьшено до ${order.turns_left}`);

              // Сохраняем обновленные данные рынка
              marketData[i][0] = JSON.stringify(orders);
              return true;
            }

            if (!orderFound) {
              Logger.log(`[WARNING] Объявление ${orderId} не найдено на рынке, удаляем`);
              return false;
            }

            return true;
          });

          // Обновляем данные в `data`
          data['Постройки_ОсновнаяИнформация'][rowIndex][0] = JSON.stringify(buildingsArray);
        });
      } catch (err) {
        Logger.log(`[ERROR] Ошибка обработки зданий в строке ${rowIndex + 1}: ${err.message}`);
      }
    });

  } catch (error) {
    Logger.log(`[ERROR] ${error.message}`);
  }

  return newMessages;
}