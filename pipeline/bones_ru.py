"""Русские названия костей модели Z-Anatomy (для подписи при клике и списка «Кости» на странице сустава)."""
import re

NAMES = {
    "Atlas (C1)": "Атлант (I шейный позвонок)", "Axis (C2)": "Осевой позвонок (II шейный)",
    "Body of sternum": "Тело грудины", "Manubrium of sternum": "Рукоятка грудины",
    "Xiphoid process": "Мечевидный отросток", "Clavicle": "Ключица", "Scapula": "Лопатка",
    "Humerus": "Плечевая кость", "Radius": "Лучевая кость", "Ulna": "Локтевая кость",
    "Scaphoid bone": "Ладьевидная кость", "Lunate bone": "Полулунная кость",
    "Triquetrum bone": "Трехгранная кость", "Pisiform bone": "Гороховидная кость",
    "Trapezium bone": "Кость-трапеция", "Trapezoid bone": "Трапециевидная кость",
    "Capitate bone": "Головчатая кость", "Hamate bone": "Крючковидная кость",
    "Hip bone": "Тазовая кость", "Sacrum": "Крестец", "Coccyx": "Копчик", "Femur": "Бедренная кость",
    "Patella": "Надколенник", "Tibia": "Большеберцовая кость", "Fibula": "Малоберцовая кость",
    "Talus": "Таранная кость", "Calcaneus": "Пяточная кость", "Navicular bone": "Ладьевидная кость стопы",
    "Cuboid bone": "Кубовидная кость", "Medial cuneiform bone": "Медиальная клиновидная кость",
    "Intermediate cuneiform bone": "Промежуточная клиновидная кость",
    "Lateral cuneiform bone": "Латеральная клиновидная кость", "Sesamoid bones of foot": "Сесамовидные кости стопы",
    "Frontal bone": "Лобная кость", "Parietal bone": "Теменная кость", "Occipital bone": "Затылочная кость",
    "Temporal bone": "Височная кость", "Sphenoid bone": "Клиновидная кость", "Ethmoid bone": "Решетчатая кость",
    "Mandible": "Нижняя челюсть", "Maxilla": "Верхняя челюсть", "Nasal bone": "Носовая кость",
    "Vomer": "Сошник", "Zygomatic bone": "Скуловая кость", "Palatine bone": "Небная кость",
    "Lacrimal bone": "Слезная кость", "Inferior nasal concha bone": "Нижняя носовая раковина",
    "Hyoid bone": "Подъязычная кость", "Malleus": "Молоточек", "Incus": "Наковальня", "Stapes": "Стремя",
    "Thyroid cartilage": "Щитовидный хрящ", "Cricoid cartilage": "Перстневидный хрящ",
    "Arytenoid cartilage": "Черпаловидный хрящ", "Corniculate cartilage": "Рожковидный хрящ",
}
ORD = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7,
       "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11, "twelfth": 12}
ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
PHALANX = {"Proximal": "Проксимальная", "Middle": "Средняя", "Distal": "Дистальная"}
REGION = {"C": "шейный", "T": "грудной", "L": "поясничный"}


def bone_ru(name: str) -> str | None:
    if name in NAMES:
        return NAMES[name]
    if m := re.fullmatch(r"(\w+) rib", name):
        return f"{ROMAN[ORD[m[1].lower()]]} ребро"
    if m := re.fullmatch(r"Costal cartilage of (\w+) rib", name):
        return f"Реберный хрящ {ROMAN[ORD[m[1]]]} ребра"
    if m := re.fullmatch(r"(\w+) metacarpal bone", name):
        return f"{ROMAN[ORD[m[1].lower()]]} пястная кость"
    if m := re.fullmatch(r"(\w+) metatarsal bone", name):
        return f"{ROMAN[ORD[m[1].lower()]]} плюсневая кость"
    if m := re.fullmatch(r"(Proximal|Middle|Distal) phalanx of (\w+) finger of (hand|foot)", name):
        where = "кисти" if m[3] == "hand" else "стопы"
        return f"{PHALANX[m[1]]} фаланга {ROMAN[ORD[m[2]]]} пальца {where}"
    if m := re.fullmatch(r"Vertebra ([CTL])(\d+)", name):
        return f"{ROMAN[int(m[2])]} {REGION[m[1]]} позвонок ({m[1]}{m[2]})"
    if re.search(r"(incisor|canine|premolar|molar)", name):
        return "Зуб"
    return None
