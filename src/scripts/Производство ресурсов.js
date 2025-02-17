/**
 * Функция для обработки производства ресурсов зданиями.
 * Выполняет следующие шаги:
 * 1. Находит все постройки, принадлежащие нашему государству и со статусом "Активная".
 * 2. Для каждого такого здания:
 *    2.1 Ищет шаблон здания в "Постройки_Шаблоны" по совпадению building_name с name шаблона.
 *         Если в шаблоне отсутствует ключ resource_production – здание пропускается.
 *    2.2 Копирует массив resource_production из шаблона, вычисляя для каждого ресурса:
 *         current_quantity = (quantity * building_level) * production_efficiency.
 *         Ключ quantity остаётся без изменений.
 * 3. Добавляет ресурсы из resource_production в warehouse здания, увеличивая current_quantity на складе.
 *
 * @param {Object} data - Объект с данными из именованных диапазонов.
 * @returns {Array} messages - Массив сообщений для журнала событий.
 */
function processResourceProduction(data) {
  let messages = [];
  try {
    // 0. Извлекаем stateName из "Переменные"
    let stateName;
    {
      const targetIdentifier = 'Основные данные государства';
      const targetRow = data['Переменные']?.find(row => row[0] === targetIdentifier);
      if (targetRow && targetRow[1]) {
        const jsonMatch = targetRow[1].match(/\{.*\}/);
        if (jsonMatch) {
          const variablesJson = JSON.parse(jsonMatch[0]);
          stateName = variablesJson.state_name;
          if (!stateName) {
            messages.push(`[Ошибка] Ключ "state_name" не найден в Переменные.`);
            return messages;
          }
        } else {
          messages.push(`[Ошибка] Не удалось извлечь JSON из строки "${targetIdentifier}" в Переменные.`);
          return messages;
        }
      } else {
        messages.push(`[Ошибка] Идентификатор "${targetIdentifier}" не найден в Переменные.`);
        return messages;
      }
    }
    
    // 1. Собираем шаблоны зданий: создаём карту по имени шаблона
    const templateMap = {};
    const templatesData = data['Постройки_Шаблоны'] || [];
    templatesData.forEach((row, index) => {
      const cell = row[0];
      if (cell && cell.trim() !== "") {
        try {
          const templateObj = JSON.parse(cell);
          if (templateObj.name) {
            templateMap[templateObj.name] = templateObj;
          } else {
            messages.push(`[Ошибка] Шаблон в строке ${index + 1} не содержит "name".`);
          }
        } catch (e) {
          messages.push(`[Ошибка] Парсинг шаблона в строке ${index + 1}: ${e.message}`);
        }
      }
    });
    
    // 2. Обрабатываем здания из "Постройки_ОсновнаяИнформация"
    const buildingsData = data['Постройки_ОсновнаяИнформация'] || [];
    buildingsData.forEach((row, rowIndex) => {
      const cell = row[0];
      if (!cell || cell.trim() === "") return;
      try {
        let buildingsArray = JSON.parse(cell);
        let updatedBuildings = false;
        
        buildingsArray.forEach(building => {
          // Обрабатываем только здания нашего государства и со статусом "Активная"
          if (building.building_owner !== stateName || building.status !== "Активная") return;
          
          // 2.1 Поиск шаблона по совпадению building_name
          const template = templateMap[building.building_name];
          if (!template) {
            messages.push(`[Предупреждение] Шаблон для здания "${building.building_name}" не найден.`);
            return;
          }
          
          // Если в шаблоне отсутствует ключ resource_production – пропускаем здание
          if (!template.resource_production || !Array.isArray(template.resource_production)) return;
          
          // 2.2 Копируем массив resource_production с вычислением current_quantity для каждого ресурса
          const newResourceProduction = [];
          template.resource_production.forEach(item => {
            if (typeof item.quantity !== 'number') return;
            const baseQuantity = item.quantity;
            const level = building.building_level || 1;
            let productionEfficiency = 1;
            if (building.building_modifiers && typeof building.building_modifiers.production_efficiency === 'number') {
              productionEfficiency = building.building_modifiers.production_efficiency;
            }
            const currentQuantity = (baseQuantity * level) * productionEfficiency;
            newResourceProduction.push({
              resource: item.resource,
              quantity: baseQuantity,
              current_quantity: currentQuantity
            });
          });
          if (newResourceProduction.length === 0) return;
          
          // Обновляем ключ resource_production здания
          building.resource_production = newResourceProduction;
          
          // 3. Добавляем произведённые ресурсы в warehouse здания
          if (!building.warehouse) {
            messages.push(`[Ошибка] Здание "${building.building_name}" не содержит склада (warehouse).`);
          } else {
            newResourceProduction.forEach(item => {
              const resourceName = item.resource;
              const producedAmount = item.current_quantity;
              if (!building.warehouse.hasOwnProperty(resourceName)) {
                messages.push(`[Событие] Ресурс "${resourceName}" отсутствует на складе здания "${building.building_name}". Создаю запись.`);
                // Создаем запись для ресурса, предположим reserve_level = 0
                building.warehouse[resourceName] = { current_quantity: 0, reserve_level: 0 };
              }
              building.warehouse[resourceName].current_quantity += producedAmount;
            });
          }
          
          updatedBuildings = true;
        });
        
        // Если в данной строке были изменения – обновляем строку данных
        if (updatedBuildings) {
          buildingsData[rowIndex][0] = JSON.stringify(buildingsArray);
        }
      } catch (e) {
        messages.push(`[Ошибка] Обработка зданий в строке ${rowIndex + 1}: ${e.message}`);
      }
    });
  } catch (error) {
    messages.push(`[Ошибка] processResourceProduction: ${error.message}`);
  }
  return messages;
}
