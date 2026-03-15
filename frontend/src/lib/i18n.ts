import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../translations/locales/en.json';
import hi from '../translations/locales/hi.json';
import te from '../translations/locales/te.json';
import ml from '../translations/locales/ml.json';
import ta from '../translations/locales/ta.json';

const resources = {
  en: { translation: en },
  hi: { translation: hi },
  te: { translation: te },
  ml: { translation: ml },
  ta: { translation: ta }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en', // default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

export default i18n;
