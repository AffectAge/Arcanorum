from qgis.core import (
    QgsProject,
    QgsRasterLayer,
    QgsVectorLayer
)
import processing

def create_single_polygon_per_color(raster_name="map"):
    """
    1. Находит в проекте растр по имени `raster_name`.
    2. С помощью 'Raster Calculator' создает временный одноканальный растр 
       (значение = R*65536 + G*256 + B).
    3. Полигонализирует его (Polygonize).
    4. Выполняет Dissolve по полю DN, чтобы один цвет стал одним многоугольником.
    5. Добавляет итоговый слой в проект.
    """

    # --- ШАГ A: Находим растровый слой по имени ---
    raster_layer = None
    for layer in QgsProject.instance().mapLayers().values():
        if layer.name() == raster_name and isinstance(layer, QgsRasterLayer):
            raster_layer = layer
            break

    if not raster_layer or not raster_layer.isValid():
        raise Exception(f"Растровый слой '{raster_name}' не найден или некорректен.")

    # Предполагаем, что растр: band1=R, band2=G, band3=B (8-битные каналы)
    expression = f"({raster_name}@1 * 65536) + ({raster_name}@2 * 256) + ({raster_name}@3)"

    # --- ШАГ B: Raster Calculator -> TEMPORARY_OUTPUT ---
    params_calc = {
        'EXPRESSION': expression,
        'LAYERS': [raster_layer.source()],
        'CELLSIZE': None,
        'EXTENT': None,
        'CRS': raster_layer.crs().authid(),
        'OUTPUT': 'TEMPORARY_OUTPUT'
    }
    calc_result = processing.run("qgis:rastercalculator", params_calc)
    calc_output = calc_result['OUTPUT']  # Может быть путём или сразу слоем, но обычно путь к временному растру

    # --- ШАГ C: Polygonize -> TEMPORARY_OUTPUT ---
    # Если используете "gdal:polygonize" и 'TEMPORARY_OUTPUT', 
    # в QGIS 3.22+ на выходе, вероятно, будет тоже сразу слой.
    params_polygonize = {
        'INPUT': calc_output,
        'BAND': 1,
        'FIELD': 'DN',
        'EIGHT_CONNECTEDNESS': False,
        'OUTPUT': 'TEMPORARY_OUTPUT'
    }
    poly_result = processing.run("gdal:polygonize", params_polygonize)
    polygonized_output = poly_result['OUTPUT']

    # --- ШАГ D: Dissolve -> TEMPORARY_OUTPUT ---
    params_dissolve = {
        'INPUT': polygonized_output,
        'FIELD': ['DN'],
        'OUTPUT': 'TEMPORARY_OUTPUT'
    }
    dissolve_result = processing.run("native:dissolve", params_dissolve)
    
    # Теперь в dissolve_result['OUTPUT'] часто лежит уже QgsVectorLayer
    polygons_layer = dissolve_result['OUTPUT']  # НЕ создаём QgsVectorLayer заново
    
    # Проверим, действительно ли это QgsVectorLayer:
    if not isinstance(polygons_layer, QgsVectorLayer):
        # Если здесь оказалось не слой, а путь к файлу,
        # тогда создаем вручную QgsVectorLayer
        polygons_layer = QgsVectorLayer(polygons_layer, "map_provinces", "ogr")
        if not polygons_layer.isValid():
            raise Exception("Слой с полигонами недействителен после Dissolve.")
    
    # --- ШАГ E: Добавляем слой в проект ---
    polygons_layer.setName("map_provinces")  # Название слоя в QGIS
    QgsProject.instance().addMapLayer(polygons_layer)

    print("Готово! Получили единый (multi)полигон на каждый цвет растра.")

# --- Пример вызова ---
create_single_polygon_per_color("map")
