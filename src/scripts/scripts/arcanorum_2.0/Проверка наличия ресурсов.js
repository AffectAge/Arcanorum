/**
 * Функция для обработки шаблонов построек на основе resource_extraction и обновления allowed_building_state и allowed_building_others
 * @param {Object} data - Объект с данными из именованных диапазонов.
 * @param {Spreadsheet} spreadsheet - Активная таблица.
 * @returns {Array} messages - Массив сообщений для журнала событий.
 */
function processRequiredResources(data, spreadsheet) {
  let messages = [];
  
  try {
    // Извлечение stateName из Переменные_Основные
    const variablesData = data['Переменные_Основные'];
    if (!variablesData || variablesData.length === 0 || !variablesData[0][0]) {
      messages.push(`[Ошибка][processRequiredResources] Переменные_Основные пуст или не содержит stateName.`);
      return messages;
    }
    
    let stateName;
    try {
      const variables = JSON.parse(variablesData[0][0]);
      if (!variables.state_name) {
        messages.push(`[Ошибка][processRequiredResources] Переменные_Основные не содержит ключа "state_name".`);
        return messages;
      }
      stateName = variables.state_name;
    } catch (e) {
      messages.push(`[Ошибка][processRequiredResources] Ошибка при парсинге JSON из Переменные_Основные: ${e.message}`);
      return messages;
    }
    
    // Клонирование данных для обновления
    let updatedTemplates = JSON.parse(JSON.stringify(data['Постройки_Шаблоны']));
  
    // 1. Парсинг провинций и группировка по владельцам
    const provincesData = data['Провинции_ОсновнаяИнформация'];
    if (!provincesData || provincesData.length === 0) {
      messages.push(`[Ошибка][processRequiredResources] Провинции_ОсновнаяИнформация пуст или не содержит данных.`);
      return messages;
    }
  
    const provinceResourcesMap = {}; // id -> { resource: quantity }
    const stateProvinces = []; // Провинции нашего государства
    const otherProvinces = []; // Провинции других государств
  
    provincesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const province = JSON.parse(cell);
          if (province.id) {
            if (province.owner === stateName) {
              stateProvinces.push(province.id);
            } else {
              otherProvinces.push(province.id);
            }
  
            if (province.resources && Array.isArray(province.resources)) {
              const resources = {};
              province.resources.forEach(res => {
                if (res.resource && typeof res.quantity === 'number') {
                  resources[res.resource] = res.quantity;
                }
              });
              provinceResourcesMap[province.id] = resources;
            } else {
              // Если нет ресурсов, считаем, что провинция не соответствует критериям
              provinceResourcesMap[province.id] = {};
            }
          } else {
            messages.push(`[Ошибка][processRequiredResources] Провинция в строке ${index + 1} не содержит ключа "id".`);
          }
        } catch (e) {
          messages.push(`[Ошибка][processRequiredResources] Ошибка при парсинге JSON из Провинции_ОсновнаяИнформация, строка ${index + 1}: ${e.message}`);
        }
      }
    });
  
    // 2. Парсинг шаблонов построек
    const templatesData = data['Постройки_Шаблоны'];
    if (!templatesData || templatesData.length === 0) {
      messages.push(`[Ошибка][processRequiredResources] Постройки_Шаблоны пуст или не содержит данных.`);
      return messages;
    }
  
    // Парсинг шаблонов
    const templates = []; // { data: templateObject, row: rowIndex }
    templatesData.forEach((row, index) => {
      const cell = row[0];
      if (cell) {
        try {
          const template = JSON.parse(cell);
          if (!template.name) {
            messages.push(`[Ошибка][processRequiredResources] Шаблон в строке ${index + 1} не содержит ключа "name".`);
            return;
          }
          if (!template.resource_extraction) {
            messages.push(`[Ошибка][processRequiredResources] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "resource_extraction".`);
            return;
          }
          if (!Array.isArray(template.resource_extraction)) {
            messages.push(`[Ошибка][processRequiredResources] Ключ "resource_extraction" в шаблоне "${template.name}" должен быть массивом.`);
            return;
          }
          if (!template.allowed_building_state) {
            messages.push(`[Ошибка][processRequiredResources] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "allowed_building_state".`);
            return;
          }
          if (!template.allowed_building_others) {
            messages.push(`[Ошибка][processRequiredResources] Шаблон "${template.name}" в строке ${index + 1} не содержит ключа "allowed_building_others".`);
            return;
          }
          templates.push({ data: template, row: index });
        } catch (e) {
          messages.push(`[Ошибка][processRequiredResources] Ошибка при парсинге JSON из Постройки_Шаблоны, строка ${index + 1}: ${e.message}`);
        }
      }
    });
  
    if (templates.length === 0) {
      messages.push(`[Ошибка][processRequiredResources] Нет корректных шаблонов в Постройки_Шаблоны для обработки.`);
      return messages;
    }
  
    // 3. Обработка каждого шаблона
    templates.forEach(templateInfo => {
      const template = templateInfo.data;
      const templateName = template.name;
      const resourceCriteria = template.resource_extraction;
  
      // Определение необходимых ресурсов и их количеств
      const requiredResources = {};
      resourceCriteria.forEach(res => {
        if (res.resource && typeof res.quantity === 'number') {
          requiredResources[res.resource] = res.quantity;
        }
      });
  
      // Функция проверки соответствия ресурсов
      const hasRequiredResources = (resources) => {
        return Object.keys(requiredResources).every(res => (resources[res] || 0) >= requiredResources[res]);
      };
  
      // Найти все провинции, которые соответствуют критериям ресурсов
      const matchingProvincesState = stateProvinces.filter(provinceId => {
        const resources = provinceResourcesMap[provinceId] || {};
        return hasRequiredResources(resources);
      });
  
      const matchingProvincesOthers = otherProvinces.filter(provinceId => {
        const resources = provinceResourcesMap[provinceId] || {};
        return hasRequiredResources(resources);
      });
  
      // Получение текущих списков
      const currentMatchingState = template.allowed_building_state || [];
      const currentMatchingOthers = template.allowed_building_others || [];
  
      // Определение провинций, которые нужно удалить из allowed_building_state
      const provincesToRemoveState = currentMatchingState.filter(id => !matchingProvincesState.includes(id));
      if (provincesToRemoveState.length > 0) {
        // Обновляем список, удаляя неподходящие провинции
        template.allowed_building_state = currentMatchingState.filter(id => matchingProvincesState.includes(id));
        const provinceNames = provincesToRemoveState.join(', ');
        messages.push(`[Постройки][Критерии наличия ресурсов] Постройка "${templateName}" больше не может функционировать в провинциях нашего государства: ${provinceNames}, так как в этих провинциях нет необходимого количества требуемых запасов ресурсов.`);
      }
  
      // Определение провинций, которые нужно удалить из allowed_building_others
      const provincesToRemoveOthers = currentMatchingOthers.filter(id => !matchingProvincesOthers.includes(id));
      if (provincesToRemoveOthers.length > 0) {
        // Обновляем список, удаляя неподходящие провинции
        template.allowed_building_others = currentMatchingOthers.filter(id => matchingProvincesOthers.includes(id));
        const provinceNames = provincesToRemoveOthers.join(', ');
        messages.push(`[Постройки][Критерии наличия ресурсов] Постройка "${templateName}" больше не может функционировать в провинциях других государств: ${provinceNames}, так как в этих провинциях нет необходимого количества требуемых запасов ресурсов.`);
      }
  
      // **Важно:** Не добавляем новые провинции, даже если они соответствуют критериям.
      // Поэтому мы не обновляем списки добавлением новых соответствующих провинций.
  
      // Обновление шаблона в массиве обновленных шаблонов
      updatedTemplates[templateInfo.row][0] = JSON.stringify(template);
    });
    
    // Обновляем данные в объекте data
    data['Постройки_Шаблоны'] = updatedTemplates;
  
  } catch (error) {
    messages.push(`[Ошибка][processRequiredResources] processRequiredResources: ${error.message}`);
  }
  
  return messages;
}
