/**
 * «Тихое» поле форм агента: без рамки, с чертой снизу, на приподнятом фоне.
 *
 * Одно место на поле и на его раскрытый список: скругление у них обязано
 * совпадать, и держит это общий источник, а не проверка пикселей в тесте.
 */
export const QUIET_FIELD =
  "field-baseline !rounded-xl !border-0 !border-b !border-line !bg-raised focus-visible:!outline-none focus-visible:!shadow-none";

/**
 * Раскрытый список под тихим полем — тем же скруглением, включая выбранную
 * строку. Иначе внешняя карточка и её активный пункт выглядят как два
 * разных элемента, хотя это одно продолжение поля.
 */
export const QUIET_LIST = "!rounded-xl [&_[data-slot=select-item]]:!rounded-xl";
