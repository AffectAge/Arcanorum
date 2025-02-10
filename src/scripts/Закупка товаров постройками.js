/**
 * Функция для закупки товаров для зданий.
 * После обработки обновляются следующие диапазоны в объекте data:
 * - «Постройки_ОсновнаяИнформация» – данные зданий;
 * - «Международный_Рынок» – данные рынка;
 * - «Торговые_Партнёры» – данные торговых партнёров;
 * - «Товары» – данные товаров.
 *
 * @param {Object} data - Объект с данными из именованных диапазонов.
 * @returns {Array} newMessages - Массив сообщений об операциях закупки.
 */
function processPurchaseGoodsForBuildings(data) {
  const newMessages = [];
  Logger.log("[INFO] Начало работы processPurchaseGoodsForBuildings");

  // -------------------------------------------------
  // 0. Загружаем данные: определяем название государства
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

  // -------------------------------------------------
  // 1. Загружаем диапазоны
  // -------------------------------------------------
  const buildingsData = data['Постройки_ОсновнаяИнформация'] || [];
  const goodsData = data['Товары'] || [];
  const tradePartnersData = data['Торговые_Партнёры'] || [];
  const marketData = data['Международный_Рынок'] || [];

  Logger.log(`[INFO] Зданий загружено: ${buildingsData.length}`);
  Logger.log(`[INFO] Товаров загружено: ${goodsData.length}`);
  Logger.log(`[INFO] Торговых партнёров загружено: ${tradePartnersData.length}`);
  Logger.log(`[INFO] Объявлений на рынке: ${marketData.length}`);

  // -------------------------------------------------
  // 2. Парсим товары в goodsMap
  // -------------------------------------------------
  const goodsMap = {};
  goodsData.forEach((row, rowIndex) => {
    const cell = row[0];
    if (!cell || cell.trim() === "") return;
    try {
      const goodObj = JSON.parse(cell);
      goodsMap[goodObj.good_name] = { good_type: goodObj.good_type };
    } catch (err) {
      Logger.log(`[ERROR] Ошибка парсинга товара в строке ${rowIndex + 1}: ${err.message}`);
    }
  });

  // -------------------------------------------------
  // 3. Парсим торговых партнёров в tradePartners
  // -------------------------------------------------
  const tradePartners = {};
  tradePartnersData.forEach((row, rowIndex) => {
    const cell = row[0];
    if (!cell || cell.trim() === "") return;
    try {
      const partnersArray = JSON.parse(cell);
      if (Array.isArray(partnersArray)) {
        partnersArray.forEach(partner => {
          tradePartners[partner.country] = partner;
        });
      }
    } catch (err) {
      Logger.log(`[ERROR] Ошибка парсинга торговых партнёров в строке ${rowIndex + 1}: ${err.message}`);
    }
  });

  // -------------------------------------------------
  // 4. Обрабатываем здания для закупки товаров
  // -------------------------------------------------
  buildingsData.forEach((row, rowIndex) => {
    const cell = row[0];
    if (!cell || cell.trim() === "") return;
    try {
      const buildingsArray = JSON.parse(cell);
      if (!Array.isArray(buildingsArray) || buildingsArray.length === 0) {
        Logger.log(`[ERROR] Данные здания в строке ${rowIndex + 1} пустые или некорректны`);
        return;
      }

      buildingsArray.forEach((building) => {
        Logger.log(`[DEBUG] Проверяем здание ${building.building_name} в провинции ${building.province_id}`);

        if (building.building_owner !== stateName || building.status !== "Активная") {
          Logger.log(`[INFO] Пропускаем здание: ${building.building_name} (не принадлежит ${stateName} или неактивно)`);
          return;
        }

        // Перебор товаров на складе здания
        for (const goodName in building.warehouse) {
          const stockData = building.warehouse[goodName];
          const currentQuantity = Number(stockData.current_quantity) || 0;
          const reserveLevel = Number(stockData.reserve_level) || 0;

          if (currentQuantity >= reserveLevel) {
            Logger.log(`[INFO] Товар "${goodName}" в здании ${building.building_name} в достатке.`);
            continue;
          }

          const neededQuantity = reserveLevel - currentQuantity;
          Logger.log(`[INFO] Недостаточно товара "${goodName}" в здании ${building.building_name}: нужно докупить ${neededQuantity}`);

          const goodInfo = goodsMap[goodName];
          if (!goodInfo) {
            Logger.log(`[ERROR] Товар "${goodName}" не найден в таблице "Товары"`);
            continue;
          }
          const transportType = goodInfo.good_type;

          // Поиск стран-партнёров, у которых есть нужный товар и достаточно транспорта
          const availableCountries = [];
          for (const country in tradePartners) {
            const partner = tradePartners[country];
            if (
              partner.allowed_goods &&
              partner.allowed_goods[goodName] &&
              partner.total_transport &&
              partner.total_transport.available &&
              Number(partner.total_transport.available[transportType]) >= neededQuantity
            ) {
              availableCountries.push(country);
            }
          }
          if (availableCountries.length === 0) {
            Logger.log(`[WARNING] Нет доступных стран для импорта "${goodName}" для здания ${building.building_name}`);
            continue;
          }

          // Обработка заказов на рынке для закупки товара
          let orderProcessed = false;
          for (let mRowIndex = 0; mRowIndex < marketData.length; mRowIndex++) {
            let orders = [];
            try {
              orders = JSON.parse(marketData[mRowIndex][0] || "[]");
            } catch (err) {
              Logger.log(`[ERROR] Ошибка парсинга рынка в строке ${mRowIndex + 1}: ${err.message}`);
              continue;
            }

            // Фильтруем заказы: по товару и странам из availableCountries
            const relevantOrders = orders.filter(order =>
              order.name === goodName && availableCountries.includes(order.country)
            );
            if (relevantOrders.length === 0) continue;

            // Рассчитываем итоговую цену с учетом тарифа для каждого заказа
            relevantOrders.forEach(order => {
              let tariff = 1;
              if (tradePartners[order.country]?.allowed_goods?.[goodName]?.tariff) {
                tariff = Number(tradePartners[order.country].allowed_goods[goodName].tariff) || 1;
              }
              order.finalPrice = Number(order.price) * tariff;
            });
            // Сортируем заказы по итоговой цене
            relevantOrders.sort((a, b) => a.finalPrice - b.finalPrice);

            let remainingToBuy = neededQuantity;
            relevantOrders.forEach(order => {
              if (remainingToBuy <= 0) return;
              const availableQuantity = Number(order.availableQuantity) || 0;
              if (availableQuantity <= 0) return;
              const purchaseAmount = Math.min(remainingToBuy, availableQuantity);
              remainingToBuy -= purchaseAmount;

              // Обновляем склад здания: суммируем закупленное количество
              stockData.current_quantity = currentQuantity + (neededQuantity - remainingToBuy);

              // Обновляем данные торгового партнёра:
              if (tradePartners[order.country].allowed_goods[goodName].imported === undefined) {
                tradePartners[order.country].allowed_goods[goodName].imported = 0;
              }
              tradePartners[order.country].allowed_goods[goodName].imported += purchaseAmount;
              if (tradePartners[order.country].allowed_goods[goodName].tariff_income === undefined) {
                tradePartners[order.country].allowed_goods[goodName].tariff_income = 0;
              }
              tradePartners[order.country].allowed_goods[goodName].tariff_income += purchaseAmount * Number(order.price);

              // Списываем соответствующее количество транспорта у торгового партнёра
              if (
  tradePartners[order.country].total_transport &&
  tradePartners[order.country].total_transport.available &&
  typeof tradePartners[order.country].total_transport.available[transportType] === 'number'
) {
  tradePartners[order.country].total_transport.available[transportType] -= purchaseAmount;
} else {
  Logger.log(`[WARNING] Не удалось списать транспорт типа "${transportType}" для страны ${order.country}`);
}


              // Обновляем данные рыночного заказа:
              order.availableQuantity = availableQuantity - purchaseAmount;
              if (order.income === undefined) {
                order.income = 0;
              }
              order.income += purchaseAmount * Number(order.price);

              newMessages.push(`[✅ Закупка] ${building.building_name} в провинции ${building.province_id} закупил ${purchaseAmount} ед. "${goodName}" у ${order.country} по цене ${order.finalPrice}`);
              orderProcessed = true;
            });
            // Сохраняем обновленные заказы обратно в ячейку рынка
            marketData[mRowIndex][0] = JSON.stringify(orders);
            if (remainingToBuy <= 0) break;
          }
          if (!orderProcessed) {
            Logger.log(`[WARNING] Не удалось полностью покрыть потребность в "${goodName}" для здания ${building.building_name}`);
          }
        } // конец перебора товаров здания
      }); // конец перебора зданий в строке

      // После обработки всех зданий в строке обновляем ячейку с данными зданий
      data['Постройки_ОсновнаяИнформация'][rowIndex][0] = JSON.stringify(buildingsArray);
    } catch (err) {
      Logger.log(`[ERROR] Ошибка обработки зданий в строке ${rowIndex + 1}: ${err.message}`);
    }
  }); // конец перебора строк «Постройки_ОсновнаяИнформация»

  // -------------------------------------------------
  // 5. Обновляем диапазон торговых партнёров в объекте data
  // -------------------------------------------------
  // Предполагается, что весь список торговых партнёров хранится в одной ячейке диапазона
  data['Торговые_Партнёры'][0][0] = JSON.stringify(Object.values(tradePartners));

  // -------------------------------------------------
  // 6. Обновляем диапазон товаров в объекте data
  // -------------------------------------------------
  // Проходим по каждой строке диапазона «Товары» и обновляем содержимое на основе goodsMap.
  goodsData.forEach((row, rowIndex) => {
    const cell = row[0];
    if (!cell || cell.trim() === "") return;
    try {
      const goodObj = JSON.parse(cell);
      if (goodObj && goodObj.good_name && goodsMap[goodObj.good_name]) {
        // Обновляем, например, поле good_type (если оно могло измениться)
        goodObj.good_type = goodsMap[goodObj.good_name].good_type;
        // Здесь можно обновить и другие свойства, если требуется
      }
      data['Товары'][rowIndex][0] = JSON.stringify(goodObj);
    } catch (err) {
      Logger.log(`[ERROR] Ошибка обновления товара в строке ${rowIndex + 1}: ${err.message}`);
    }
  });

  // Функция возвращает массив сообщений, а запись обновлённых данных в листы
  // производится отдельно (например, через вызов updateRanges(data, spreadsheet))
  return newMessages;
}
