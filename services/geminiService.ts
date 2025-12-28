
import { GoogleGenAI, Type } from "@google/genai";
import { AppState, AIAnalysisResult, TimeSlot } from "../types";
import { SLOT_HOURS } from "../constants";

export const analyzeHealthStatus = async (state: AppState): Promise<AIAnalysisResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const report = state.currentReport;
  const medications = state.medications || []; // Use state meds
  const takenMeds = medications.filter(m => state.takenMedications[m.id]);
  const takenMedsNames = takenMeds.map(m => m.name);
  
  const currentHour = new Date().getHours();
  const missedMeds = medications.filter(m => {
    const slotHour = SLOT_HOURS[m.timeSlot as TimeSlot];
    return !state.takenMedications[m.id] && currentHour > slotHour;
  });

  const potentialSideEffectsData = takenMeds
    .filter(m => m.sideEffects)
    .map(m => `${m.name}: (${m.sideEffects?.join(', ')})`)
    .join(' | ');

  const vitalsText = `
    - ضغط الدم: ${report.systolicBP || '--'}/${report.diastolicBP || '--'}
    - سكر الدم: ${report.bloodSugar || '--'} mg/dL
    - نسبة الأكسجين: ${report.oxygenLevel || '--'}%
    - نبض القلب: ${report.heartRate || '--'} نبضة/دقيقة
    - شرب الماء: ${report.waterIntake || 0} أكواب
    - الحالة المزاجية: ${report.mood || 'غير محدد'}
  `;

  const prompt = `
    أنت مساعد طبي ذكي خبير في صحة المسنين. حلل حالة المريض ${state.patientName} (العمر: ${state.patientAge}):
    
    البيانات الحيوية اليومية:
    ${vitalsText}

    الأدوية التي تم تناولها اليوم:
    ${takenMedsNames.join(', ') || 'لا يوجد'}

    الأدوية التي تأخر المريض عن موعدها:
    ${missedMeds.map(m => m.name).join(', ') || 'لا يوجد'}

    الأعراض الجانبية المعروفة لهذه الأدوية:
    ${potentialSideEffectsData}

    الأعراض التي يشكو منها المريض حالياً:
    ${report.symptoms.join(', ') || 'لا توجد'}
    ملاحظات المريض: ${report.notes || 'لا يوجد'}

    المطلوب:
    1. تحليل شامل للحالة بلهجة حنونة ومشجعة.
    2. التنبيه فوراً إذا كان هناك تأخير في أدوية ضرورية (Critical).
    3. ربط الأعراض الحالية بالأعراض الجانبية المحتملة للأدوية.
    4. تقديم نصائح وWarnings واضحة.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      thinkingConfig: { thinkingBudget: 2000 },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING, description: "ملخص دافئ وشامل للحالة" },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "نصائح عملية للحياة اليومية" },
          warnings: { type: Type.ARRAY, items: { type: Type.STRING }, description: "تنبيهات طبية عاجلة بناءً على القراءات، التأخير، أو الأعراض الجانبية" },
          positivePoints: { type: Type.ARRAY, items: { type: Type.STRING }, description: "رسائل دعم معنوي" },
          potentialSideEffects: { type: Type.ARRAY, items: { type: Type.STRING }, description: "الأعراض التي قد تكون مرتبطة بالأدوية" }
        },
        required: ["summary", "recommendations", "warnings", "positivePoints"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("AI response was empty");
  
  try {
    return JSON.parse(text) as AIAnalysisResult;
  } catch (e) {
    console.error("Failed to parse JSON:", text);
    throw new Error("Invalid AI output format");
  }
};
