from qgis.core import (
    QgsProject, QgsVectorLayer, QgsGeometry, QgsFeature, QgsSpatialIndex
)

def merge_and_remove_small_polygons(layer, min_pixel_area=100):
    """Удаляет полигоны меньше 100 пикселей и объединяет малые полигоны (менее 15% от среднего) с соседними."""
    
    if not layer:
        print("Ошибка: слой не найден.")
        return
    
    # Проверяем, есть ли объекты в слое
    features = list(layer.getFeatures())
    if not features:
        print("Ошибка: в слое нет полигонов.")
        return
    
    # Удаляем полигоны, у которых площадь меньше min_pixel_area
    layer.startEditing()
    deleted_polygons = 0

    for feature in features:
        geom = feature.geometry()
        if geom and geom.area() < min_pixel_area:
            layer.deleteFeature(feature.id())
            deleted_polygons += 1

    layer.commitChanges()
    
    print(f"Удалено {deleted_polygons} полигонов с площадью < {min_pixel_area} пикселей.")

    # Получаем обновленный список полигонов
    features = list(layer.getFeatures())
    
    if not features:
        print("Ошибка: после удаления в слое не осталось полигонов.")
        return

    # Получаем площади оставшихся полигонов
    areas = [feat.geometry().area() for feat in features if feat.geometry()]
    
    if not areas:
        print("Ошибка: у оставшихся полигонов нет геометрии.")
        return
    
    avg_area = sum(areas) / len(areas)  # Средняя площадь
    min_area_threshold = avg_area * 0.15  # 15% от средней площади

    print(f"Средняя площадь оставшихся полигонов: {avg_area}")
    print(f"Минимальный порог для объединения: {min_area_threshold}")

    # Создаем пространственный индекс для быстрого поиска соседей
    index = QgsSpatialIndex()
    for feat in features:
        if feat.geometry():
            index.insertFeature(feat)
    
    # Начинаем редактирование слоя
    layer.startEditing()
    
    processed_ids = set()  # Множество обработанных ID
    
    for feature in features:
        if feature.id() in processed_ids:
            continue  # Уже объединён
        
        geom = feature.geometry()
        if not geom or geom.area() >= min_area_threshold:
            continue  # Пропускаем полигоны, которые больше 15% от среднего размера
        
        # Находим соседние полигоны
        neighbors = index.intersects(geom.boundingBox())
        neighbors = [layer.getFeature(n_id) for n_id in neighbors if n_id != feature.id()]

        if not neighbors:
            print(f"Предупреждение: у полигона {feature.id()} нет соседей.")
            continue  # Если нет соседей, пропускаем
        
        # Ищем ближайший сосед
        nearest_feature = min(neighbors, key=lambda f: geom.distance(f.geometry()), default=None)

        if nearest_feature:
            new_geom = geom.combine(nearest_feature.geometry())  # Объединение геометрии
            
            # Обновляем геометрию ближайшего соседа
            layer.dataProvider().changeGeometryValues({nearest_feature.id(): new_geom})
            
            # Удаляем малый полигон
            layer.deleteFeature(feature.id())

            # Помечаем обработанные ID
            processed_ids.add(feature.id())
            processed_ids.add(nearest_feature.id())

    layer.commitChanges()  # Сохраняем изменения
    print("Объединение малых полигонов завершено.")

# Указываем название слоя
layer_name = "map_provinces"

# Получаем слой по имени
layers = QgsProject.instance().mapLayersByName(layer_name)

if layers:
    merge_and_remove_small_polygons(layers[0], min_pixel_area=100)
else:
    print(f"Ошибка: слой '{layer_name}' не найден!")
