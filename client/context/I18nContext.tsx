import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Locale = "ar" | "en";

type Dict = Record<string, { ar: string; en: string }>; // can be extended later

const dict: Dict = {
  brand_title: { ar: "نظام الإقامة", en: "Accommodation System" },
  brand_sub: {
    ar: "نظام إدارة الإقامة والتحقق",
    en: "Accommodation Management and Verification",
  },
  nav_workers: { ar: "المتقدمات", en: "Applicants" },

  // AlertsBox - Dialog and form labels
  applicant_data_entry: {
    ar: "متابعة إدخال بيانات العاملة",
    en: "Applicant Data Entry",
  },
  name_label: { ar: "الاسم", en: "Name" },
  arrival_date_label: {
    ar: "تاريخ الوصول (dd/mm/yyyy)",
    en: "Arrival Date (dd/mm/yyyy)",
  },
  branch_label: { ar: "الفرع", en: "Branch" },
  face_capture_label: {
    ar: "التقاط صورة الوجه (إلزامي)",
    en: "Face Capture (Required)",
  },
  or_photo_label: { ar: "صورة OR (اختياري)", en: "OR Photo (Optional)" },
  passport_photo_label: {
    ar: "صورة الجواز (اختياري)",
    en: "Passport Photo (Optional)",
  },

  // AlertsBox - Button labels
  enter_data_btn: { ar: "إدخال", en: "Enter" },
  start_camera_btn: { ar: "تشغيل الكاميرا", en: "Start Camera" },
  stop_btn: { ar: "إيقاف", en: "Stop" },
  switch_camera_btn: { ar: "تبديل الكاميرا", en: "Switch Camera" },
  capture_photo_btn: { ar: "التقاط صورة", en: "Capture Photo" },
  retake_photo_btn: { ar: "إعادة الالتقاط", en: "Retake" },
  upload_or_btn: { ar: "رفع صورة OR", en: "Upload OR Photo" },
  upload_passport_btn: { ar: "رفع صورة الجواز", en: "Upload Passport" },
  cancel_btn: { ar: "إلغاء", en: "Cancel" },
  save_btn: { ar: "حفظ", en: "Save" },

  // AlertsBox - Placeholders and validation
  example_date: { ar: "مثال: 05/09/2024", en: "Example: 05/09/2024" },
  choose_branch: { ar: "اختر الفرع", en: "Choose Branch" },
  applicant_name_placeholder: { ar: "اسم العاملة", en: "Applicant Name" },
  date_format_error: {
    ar: "الرجاء إدخال التاريخ بهذه الصيغة فقط: dd/mm/yyyy",
    en: "Please enter date in dd/mm/yyyy format only",
  },

  // AlertsBox - Status and time labels
  locked_status: { ar: "محظورة", en: "Locked" },
  time_remaining: { ar: "متبقّي", en: "Remaining" },
  since_label: { ar: "منذ", en: "Since" },
  amount_label: { ar: "المبلغ:", en: "Amount:" },

  // AlertsBox - Toast messages
  face_not_detected: {
    ar: "لم يتم اكتشاف وجه واضح",
    en: "No clear face detected",
  },
  name_required: { ar: "الاسم مطلوب", en: "Name is required" },
  date_format_required: {
    ar: "صيغة التاريخ يجب أن تكون dd/mm/yyyy",
    en: "Date format must be dd/mm/yyyy",
  },
  choose_branch_required: { ar: "اختر الفرع", en: "Choose a branch" },
  face_photo_required: {
    ar: "التقط صورة الوجه أولاً",
    en: "Please capture a face photo first",
  },
  liveness_skipped: {
    ar: "تخطّي فحص الحيوية بسبب ض��ف الحركة/الإضاءة.",
    en: "Liveness check skipped due to weak motion/lighting.",
  },
  data_entry_success: {
    ar: "تم الإدخال وحفظ البيانات",
    en: "Data entered and saved successfully",
  },
  camera_error: { ar: "تعذر الالتقاط", en: "Failed to capture" },

  // Time units
  hours_abbr: { ar: "س", en: "h" },
  minutes_abbr: { ar: "د", en: "m" },

  // Admin Login
  admin_login_title: { ar: "تسجيل دخول الإدارة", en: "Admin Login" },
  admin_login_desc: {
    ar: "أدخل كلمة ��لمرور للو��ول إلى لوحة التقارير.",
    en: "Enter password to access the reports dashboard.",
  },
  password_label: { ar: "كلمة المرور", en: "Password" },
  login_btn: { ar: "دخول", en: "Login" },
  wrong_password_error: { ar: "كلمة المرور غير صحيحة", en: "Wrong password" },

  // Payment Dialog
  confirm_amount_title: {
    ar: "تأكيد المبلغ ا��إلزامي",
    en: "Confirm Required Amount",
  },
  applicant_label: { ar: "العاملة:", en: "Applicant:" },
  philippine_peso: { ar: "₱ بيسو فلبيني", en: "₱ Philippine Peso" },

  // PersonSelect
  no_results: { ar: "لا توجد نتائج", en: "No results" },
  choose_name: { ar: "اختر اسماً", en: "Choose a name" },
  search_by_name: { ar: "ابحث عن الاسم...", en: "Search by name..." },
  arrival_date: { ar: "تاريخ الوصول:", en: "Arrival Date:" },

  // NoExpense page
  branch_label_short: { ar: "الفرع:", en: "Branch:" },

  // DeviceFeed
  supabase_not_configured: {
    ar: "لم يتم ضبط اتصال Supabase. يرجى توفير مفاتيح الاتصال.",
    en: "Supabase connection not configured. Please provide connection keys.",
  },
  loading: { ar: "جاري التحميل��", en: "Loading..." },
  no_device_events: {
    ar: "لا توجد أحداث من الجهاز بعد.",
    en: "No device events yet.",
  },

  // Status badges
  status_complete: { ar: "مكتمل", en: "Complete" },
  status_incomplete: { ar: "غير مكتمل", en: "Incomplete" },

  // Incomplete file handling
  incomplete_file_message: {
    ar: "ملفك غير مكتمل. ير��ى إضافة المستندات أولاً.",
    en: "Your file is incomplete. Please add documents first.",
  },
  cannot_process_payment: {
    ar: "لا يمكن معالجة الدفع لملف غير مكتمل.",
    en: "Cannot process payment for an incomplete file.",
  },
  add_documents_first: {
    ar: "يرجى إضافة المستندات أولاً.",
    en: "Please add documents first.",
  },

  // Status labels
  status_accommodation: {
    ar: "الحالة في نظام الإقامة",
    en: "Status in Accommodation System",
  },
  status_main_system: {
    ar: "الحالة في النظام الرئيسي",
    en: "Status in Main System",
  },

  // Verified section message
  verified_section_message: {
    ar: "هنا يظهر المتقدمين الذي لديهم ملف مكتمل وتم التحقق م��هم",
    en: "Here are shown applicants with complete files who have been verified",
  },

  // Index page - Title and subtitle
  page_title: {
    ar: "نظام التحقق من الإقامة",
    en: "Accommodation Verification System",
  },
  page_subtitle: {
    ar: "قم بتفعيل ميزة التحقق من الوجه للمتقدمين الجدد، وتصفح قائمة المتقدمين الذين تم التحقق منهم.",
    en: "Enable face verification for new applicants and browse the list of verified applicants.",
  },
};

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggle: () => void;
  t: (key: keyof typeof dict) => string;
  tr: (ar: string, en: string) => string;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(
    () => (localStorage.getItem("locale") as Locale) || "en",
  );

  useEffect(() => {
    localStorage.setItem("locale", locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const value = useMemo<I18nState>(
    () => ({
      locale,
      setLocale,
      toggle: () => setLocale((p) => (p === "ar" ? "en" : "ar")),
      t: (key) => dict[key]?.[locale] ?? key,
      tr: (ar, en) => (locale === "ar" ? ar : en),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback to English if context is not available
    console.warn("I18nContext not available, using fallback");
    return {
      locale: "en" as Locale,
      setLocale: () => {},
      toggle: () => {},
      t: (key: string) => key,
      tr: (_ar: string, en: string) => en,
    };
  }
  return ctx;
}
