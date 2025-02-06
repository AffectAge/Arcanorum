function processSalesForBuildings(data) {
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
    const goodsData = data['Товары'] || [];
    const marketData = data['Международный_Рынок'] || [];
    const buildingsData = data['Постройки_ОсновнаяИнформация'] || [];

    Logger.log(`[INFO] Провинций загружено: ${provincesData.length}`);
    Logger.log(`[INFO] Товаров загружено: ${goodsData.length}`);
    Logger.log(`[INFO] Строк на рынке: ${marketData.length}`);
    Logger.log(`[INFO] Зданий загружено: ${buildingsData.length}`);

    // -------------------------------------------------
    // 1. Парсим провинции
    // -------------------------------------------------
    const provinceMap = {};
    provincesData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (!cell || cell.trim() === "") return;
      try {
        const provinceObj = JSON.parse(cell);
        provinceMap[provinceObj.id] = provinceObj;
      } catch (err) {
        Logger.log(`[ERROR] Ошибка парсинга провинции в строке ${rowIndex + 1}: ${err.message}`);
      }
    });

    // -------------------------------------------------
    // 2. Парсим товары
    // -------------------------------------------------
    const goodsMap = {};
    goodsData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (!cell || cell.trim() === "") return;
      try {
        const parsedGood = JSON.parse(cell);
        goodsMap[parsedGood.good_name] = {
          good_type: parsedGood.good_type,
          current_price: parsedGood.current_price
        };
      } catch (err) {
        Logger.log(`[ERROR] Ошибка парсинга товаров в строке ${rowIndex + 1}: ${err.message}`);
      }
    });

    // -------------------------------------------------
    // 3. Обрабатываем здания
    // -------------------------------------------------
    let hasSales = false;

    buildingsData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (!cell || cell.trim() === "") return;

      try {
        Logger.log(`[DEBUG] Исходные данные ячейки: ${cell}`);

        const buildingsArray = JSON.parse(cell);
        if (!Array.isArray(buildingsArray) || buildingsArray.length === 0) {
          Logger.log(`[ERROR] Данные здания пустые или некорректны`);
          return;
        }

        buildingsArray.forEach((building, bIndex) => {
          Logger.log(`[DEBUG] Проверяем здание ${bIndex + 1}: ${JSON.stringify(building)}`);

          if (!building.building_name) {
            Logger.log(`[ERROR] В здании отсутствует поле "building_name"`);
            return;
          }

          if (building.building_owner !== stateName || building.status !== "Активная") {
            Logger.log(`[INFO] Пропускаем здание: ${building.building_name} (не принадлежит ${stateName} или неактивно)`);
            return;
          }

          Logger.log(`[INFO] Обрабатываем здание: ${building.building_name}, Провинция: ${building.province_id}`);

          const province = provinceMap[building.province_id];
          if (!province) {
            Logger.log(`[WARNING] Провинция ${building.province_id} не найдена`);
            return;
          }

          // 📦 Проверяем товары на складе
          for (const goodName in building.warehouse) {
            const goodData = building.warehouse[goodName];

            Logger.log(`[DEBUG] Проверяем товар: ${goodName}, Количество: ${goodData.current_quantity}, Резерв: ${goodData.reserve_level}`);

            if (goodData.current_quantity <= goodData.reserve_level) {
              Logger.log(`[INFO] Недостаточно товара "${goodName}". Есть ${goodData.current_quantity}, резерв ${goodData.reserve_level}`);
              continue;
            }

            if (!goodsMap[goodName]) {
              Logger.log(`[ERROR] Товар "${goodName}" отсутствует в таблице "Товары"`);
              continue;
            }

            const goodsInfo = goodsMap[goodName];
            const sellQuantity = goodData.current_quantity - goodData.reserve_level;
            const transportType = goodsInfo.good_type;
            const price = goodsInfo.current_price;

            Logger.log(`[DEBUG] Товар "${goodName}" найден. Тип транспорта: ${transportType}, Цена: ${price}`);

            // 🚛 Проверяем транспорт
            if ((province.total_transport.available[transportType] || 0) < sellQuantity) {
              Logger.log(`[WARNING] Недостаточно транспорта "${transportType}" в провинции "${province.id}". Нужно ${sellQuantity}, доступно ${province.total_transport.available[transportType]}`);
              continue;
            }

            // 🏛 Проверяем рынок
            let placed = false;
            for (let i = 0; i < marketData.length; i++) {
              let orders = JSON.parse(marketData[i][0] || "[]");

              Logger.log(`[DEBUG] Проверяем рынок (строка ${i}): занято ${orders.length} / 40`);

              if (orders.length < 40) {
                orders.push({
                  name: goodName,
                  price: price,
                  order_id: Math.floor(10000000 + Math.random() * 90000000),
                  transport_type: transportType,
                  country: stateName
                });

                marketData[i][0] = JSON.stringify(orders);
                placed = true;
                Logger.log(`[SUCCESS] Продан товар: ${goodName}, Кол-во: ${sellQuantity}, Цена: ${price}`);
                break;
              }
            }

            if (!placed) {
              Logger.log(`[WARNING] Не удалось разместить ордер для "${goodName}" — рынок заполнен`);
              continue;
            }

            // ✅ Списываем товар и транспорт
            province.total_transport.available[transportType] -= sellQuantity;
            building.warehouse[goodName].current_quantity = goodData.reserve_level;

            Logger.log(`[INFO] Товар "${goodName}" продан. Остаток на складе: ${building.warehouse[goodName].current_quantity}, Остаток транспорта "${transportType}": ${province.total_transport.available[transportType]}`);
          }
        });
      } catch (err) {
        Logger.log(`[ERROR] Ошибка обработки зданий в строке ${rowIndex + 1}: ${err.message}`);
      }
    });

    if (!hasSales) {
      Logger.log(`[INFO] Скрипт выполнился успешно, но продаж не было.`);
    }

  } catch (error) {
    Logger.log(`[ERROR] ${error.message}`);
  }

  return newMessages;
}
