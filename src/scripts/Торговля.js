/**
 * Функция для обработки закупки товаров для зданий в провинциях нашего государства.
 * Для каждого здания с ключом warehouse проверяет товары – если current_quantity меньше reserve_level,
 * вычисляет недостающий объём, затем ищет торговых партнёров, способных поставить данный товар,
 * выбирает наиболее выгодного и закупает товар, обновляя финансовые показатели, транспорт и рынок.
 *
 * @param {Object} data - Объект с данными из именованных диапазонов.
 * @param {Spreadsheet} spreadsheet - Активная таблица.
 * @returns {Array} messages - Массив сообщений для журнала.
 */
function processProcurement(data, spreadsheet) {
  let messages = [];
  try {
    // 1. Получаем имя нашего государства из диапазона "Переменные"
    const variablesData = data['Переменные'];
    if (!variablesData || variablesData.length === 0) {
      messages.push("[Ошибка][processProcurement] Нет данных в Переменные.");
      return messages;
    }
    let stateName = null;
    const targetIdentifier = 'Основные данные государства';
    let targetRow = variablesData.find(row => row[0] === targetIdentifier);
    if (targetRow && targetRow[1]) {
      const jsonMatch = targetRow[1].match(/\{.*\}/);
      if (jsonMatch) {
        try {
          let varsJson = JSON.parse(jsonMatch[0]);
          stateName = varsJson.state_name;
        } catch (e) {
          messages.push("[Ошибка][processProcurement] Ошибка парсинга JSON из Переменные.");
        }
      }
    }
    if (!stateName) {
      messages.push("[Ошибка][processProcurement] Не удалось определить state_name.");
      return messages;
    }
    
    // 2. Загружаем данные торговых партнёров из диапазона "Торговые_Партнёры"
    const tradePartnersRaw = data['Торговые_Партнёры'];
    if (!tradePartnersRaw || tradePartnersRaw.length === 0 || !tradePartnersRaw[0][0]) {
      messages.push("[Ошибка][processProcurement] Нет данных в Торговые_Партнёры.");
      return messages;
    }
    let tradePartners;
    try {
      tradePartners = JSON.parse(tradePartnersRaw[0][0]);
    } catch (e) {
      messages.push("[Ошибка][processProcurement] Невозможно распарсить данные Торговые_Партнёры.");
      return messages;
    }
    if (!tradePartners.trade_partners) {
      messages.push("[Ошибка][processProcurement] Некорректный формат Торговые_Партнёры.");
      return messages;
    }
    
    // 3. Загружаем данные Международного_Рынка
    const internationalMarketRaw = data['Международный_Рынок'];
    if (!internationalMarketRaw || internationalMarketRaw.length === 0 || !internationalMarketRaw[0][0]) {
      messages.push("[Ошибка][processProcurement] Нет данных в Международный_Рынок.");
      return messages;
    }
    // Предполагаем, что в диапазоне может быть несколько строк (по одному продукту на строку)
    let internationalProducts = [];
    for (let i = 0; i < internationalMarketRaw.length; i++) {
      let cell = internationalMarketRaw[i][0];
      if (cell) {
        try {
          let product = JSON.parse(cell);
          internationalProducts.push(product);
        } catch (e) {
          messages.push(`[Ошибка][processProcurement] Не удалось распарсить Международный_Рынок в строке ${i+1}: ${e.message}`);
        }
      }
    }
    
    // 4. Загружаем данные провинций для сопоставления зданий с владельцами
    const provincesRaw = data['Провинции_ОсновнаяИнформация'];
    let provinceMap = {};
    if (provincesRaw && provincesRaw.length > 0) {
      for (let i = 0; i < provincesRaw.length; i++) {
        let cell = provincesRaw[i][0];
        if (cell) {
          try {
            let province = JSON.parse(cell);
            if (province.id) {
              provinceMap[province.id] = province;
            }
          } catch (e) {
            messages.push(`[Ошибка][processProcurement] Не удалось распарсить Провинции_ОсновнаяИнформация в строке ${i+1}: ${e.message}`);
          }
        }
      }
    }
    
    // 5. Загружаем данные зданий из "Постройки_ОсновнаяИнформация"
    const buildingsRaw = data['Постройки_ОсновнаяИнформация'];
    if (!buildingsRaw || buildingsRaw.length === 0) {
      messages.push("[Ошибка][processProcurement] Нет данных в Постройки_ОсновнаяИнформация.");
      return messages;
    }
    let buildings = [];
    for (let i = 0; i < buildingsRaw.length; i++) {
      let cell = buildingsRaw[i][0];
      if (cell) {
        try {
          let building = JSON.parse(cell);
          buildings.push(building);
        } catch (e) {
          messages.push(`[Ошибка][processProcurement] Не удалось распарсить Постройки_ОсновнаяИнформация в строке ${i+1}: ${e.message}`);
        }
      }
    }
    
    // 6. Отбираем здания-покупатели (находящиеся в провинциях нашего государства)
    let buyerBuildings = buildings.filter(building => {
      if (!building.province_id) return false;
      let province = provinceMap[building.province_id];
      return province && province.owner === stateName;
    });
    
    // Далее – перебор покупающих зданий и обработка их склада.
    
    // ======================================================
    // Продолжение – логика закупки товара (Часть 2)
    // ======================================================
    
    // Для каждого покупающего здания, имеющего склад (warehouse), перебираем товары
    for (let b = 0; b < buyerBuildings.length; b++) {
      let building = buyerBuildings[b];
      if (!building.warehouse || !building.warehouse.items) continue;
      
      for (let i = 0; i < building.warehouse.items.length; i++) {
        let item = building.warehouse.items[i];
        // Если на складе товара достаточно – пропускаем
        if (item.current_quantity >= item.reserve_level) continue;
        
        // Вычисляем недостающий объём закупки
        let neededQuantity = item.reserve_level - item.current_quantity;
        let productName = item.name;
        messages.push(`[Инфо][processProcurement] Для товара "${productName}" необходимо купить ${neededQuantity} единиц.`);
        
        // Ищем информацию о товаре в Международном_Рынке
        let productInfo = internationalProducts.find(prod => prod.name === productName);
        if (!productInfo) {
          messages.push(`[Ошибка][processProcurement] Товар "${productName}" не найден в Международном_Рынке.`);
          continue;
        }
        let productType = productInfo.type;
        // Получаем цены – ключами являются имена стран; если для страны нет цены, можно брать productInfo.base_price
        let productPrices = productInfo.prices;
        
        // 7. Формируем список кандидатов среди торговых партнёров, у которых есть данный товар
        let candidates = [];
        for (let country in tradePartners.trade_partners) {
          let partner = tradePartners.trade_partners[country];
          if (partner.allowed_goods && partner.allowed_goods[productName]) {
            let exportDuty = partner.allowed_goods[productName].export_duty;
            // Получаем базовую цену для данной страны (если нет – используем productInfo.base_price)
            let basePrice = productPrices[country] || productInfo.base_price;
            let finalPrice = basePrice * exportDuty;
            // Получаем доступное количество транспорта для данного типа
            let availableTransport = 0;
            if (partner.transport_infrastructure &&
                partner.transport_infrastructure.available &&
                partner.transport_infrastructure.available[productType] !== undefined) {
              availableTransport = partner.transport_infrastructure.available[productType];
            }
            candidates.push({
              country: country,
              finalPrice: finalPrice,
              availableTransport: availableTransport,
              exportDuty: exportDuty,
              basePrice: basePrice,
              partner: partner  // ссылка на данные партнёра
            });
          }
        }
        if (candidates.length === 0) {
          messages.push(`[Ошибка][processProcurement] Нет торговых партнёров для товара "${productName}".`);
          continue;
        }
        // Сортируем кандидатов по окончательной цене (от меньшей к большей)
        candidates.sort((a, b) => a.finalPrice - b.finalPrice);
        
        // 8. Начинаем цикл закупки – пока не покрыта потребность, перебираем кандидатов
        let remainingNeeded = neededQuantity;
        for (let c = 0; c < candidates.length && remainingNeeded > 0; c++) {
          let candidate = candidates[c];
          if (candidate.availableTransport <= 0) continue;
          messages.push(`[Инфо][processProcurement] Пробуем закупать у ${candidate.country} по цене ${candidate.finalPrice} (транспорт: ${candidate.availableTransport}).`);
          
          // Находим здания-продавцы в стране поставщика:
          // отбираем те здания, чей province.owner равен candidate.country
          let supplierBuildings = buildings.filter(sBuilding => {
            if (!sBuilding.province_id) return false;
            let province = provinceMap[sBuilding.province_id];
            return province && province.owner === candidate.country;
          });
          
          // Перебираем здания-продавцы, у которых в складе есть нужный товар с избытком (current_quantity > reserve_level)
          for (let sb = 0; sb < supplierBuildings.length && remainingNeeded > 0; sb++) {
            let supplier = supplierBuildings[sb];
            if (!supplier.warehouse || !supplier.warehouse.items) continue;
            // Находим товар в складе поставщика
            let supplierItemIndex = supplier.warehouse.items.findIndex(it => it.name === productName);
            if (supplierItemIndex === -1) continue;
            let supplierItem = supplier.warehouse.items[supplierItemIndex];
            // Определяем, сколько товара можно продать (сверх reserve_level)
            let availableForSale = supplierItem.current_quantity - supplierItem.reserve_level;
            if (availableForSale <= 0) continue;
            
            // Ограничиваем закупку по: недостающему объёму, доступности товара у поставщика и транспортным лимитом
            let purchaseQuantity = Math.min(remainingNeeded, availableForSale, candidate.availableTransport);
            if (purchaseQuantity <= 0) continue;
            
            // Обновляем данные поставщика:
            supplierItem.current_quantity -= purchaseQuantity;
            // Обновляем доход поставщика – current_incomes (если поле отсутствует, инициализируем его)
            supplier.current_incomes = (supplier.current_incomes || 0) + candidate.basePrice * purchaseQuantity;
            // Обновляем торговые показатели для поставщика (export_revenue и export_duty_paid)
            let tradeFin = candidate.partner.allowed_goods[productName].trade_financials;
            tradeFin.export_revenue = (tradeFin.export_revenue || 0) + candidate.basePrice * purchaseQuantity;
            let dutyAmount = (candidate.basePrice * candidate.exportDuty - candidate.basePrice) * purchaseQuantity;
            tradeFin.export_duty_paid = (tradeFin.export_duty_paid || 0) + dutyAmount;
            
            // Обновляем финансовые показатели покупателя:
            // Для здания-покупателя – current_expenses увеличиваем на стоимость с учётом пошлин
            building.current_expenses = (building.current_expenses || 0) + candidate.basePrice * candidate.exportDuty * purchaseQuantity;
            // Можно также обновлять импортные показатели (import_cost и import_duty_paid)
            building.import_cost = (building.import_cost || 0) + candidate.basePrice * purchaseQuantity;
            building.import_duty_paid = (building.import_duty_paid || 0) + dutyAmount;
            
            // Обновляем рынок: увеличиваем demand для нашего государства и supply для поставщика
            productInfo.demand = productInfo.demand || {};
            productInfo.demand[stateName] = (productInfo.demand[stateName] || 0) + purchaseQuantity;
            productInfo.supply = productInfo.supply || {};
            productInfo.supply[candidate.country] = (productInfo.supply[candidate.country] || 0) + purchaseQuantity;
            
            // Снимаем затраченный транспорт у торгового партнёра
            candidate.availableTransport -= purchaseQuantity;
            
            messages.push(`[Успех][processProcurement] Закуплено ${purchaseQuantity} единиц "${productName}" у ${candidate.country} (здание: "${supplier.building_name || 'неизвестно'}").`);
            remainingNeeded -= purchaseQuantity;
          }
          
          if (remainingNeeded > 0) {
            messages.push(`[Инфо][processProcurement] После работы с ${candidate.country} осталось купить ${remainingNeeded} единиц "${productName}".`);
          }
        }
        
        if (remainingNeeded > 0) {
          messages.push(`[Предупреждение][processProcurement] Не удалось полностью покрыть потребность в "${productName}". Осталось: ${remainingNeeded} единиц.`);
        } else {
          // При успешной закупке можно увеличить запас покупателя – например, добавить купленное количество
          building.warehouse.items[i].current_quantity += neededQuantity;
          messages.push(`[Успех][processProcurement] Потребность в товаре "${productName}" полностью покрыта.`);
        }
      } // конец перебора товаров склада здания
    } // конец перебора зданий-покупателей

    // 9. После проведения закупок записываем обновлённые данные обратно в именованные диапазоны.
    updateRanges(data, spreadsheet);
    
  } catch (error) {
    messages.push(`[Критическая ошибка][processProcurement] ${error.message}`);
  }
  
  return messages;
}
