
import React, { useState, useEffect, useRef } from 'react';
import { MEDICATIONS as DEFAULT_MEDICATIONS, TIME_SLOT_CONFIG, SLOT_HOURS, SYMPTOMS } from './constants';
import { AppState, TimeSlot, AIAnalysisResult, HealthReport, Medication, DayHistory } from './types';
import { analyzeHealthStatus } from './services/geminiService';
import { speakText, stopSpeech } from './services/audioService';
import { syncPatientData, listenToPatient, requestNotificationPermission, sendNudge, db, messaging, authenticateAnonymously } from './services/firebaseService';
import { onMessage } from "firebase/messaging";
import { 
  Heart, 
  Activity, 
  ClipboardList, 
  CheckCircle, 
  BrainCircuit, 
  RefreshCw,
  Settings,
  X,
  ShieldCheck,
  Share2,
  VolumeX,
  Plus,
  Stethoscope,
  Clock,
  Send,
  Droplets,
  Thermometer,
  Wind,
  Minus,
  MessageSquare,
  AlertTriangle,
  Info,
  Zap,
  AlertCircle,
  TriangleAlert,
  UserCheck,
  Wifi,
  Bell,
  BellRing,
  Check,
  Calendar as CalendarIcon,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  User,
  Users,
  Copy,
  PenTool
} from 'lucide-react';

const generateId = () => Math.random().toString(36).substr(2, 6).toUpperCase();

const App: React.FC = () => {
  const today = new Date().toISOString().split('T')[0];
  
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem('health_track_v6');
    
    if (saved) {
      const parsed = JSON.parse(saved);
      const isSameDay = parsed.currentReport?.date === today;
      
      if (!isSameDay && parsed.currentReport?.date) {
        const yesterdayDate = parsed.currentReport.date;
        parsed.dailyReports = parsed.dailyReports || {};
        parsed.dailyReports[yesterdayDate] = {
          report: parsed.currentReport,
          takenMedications: parsed.takenMedications || {}
        };
      }

      return {
        ...parsed,
        patientId: parsed.patientId || generateId(),
        medications: parsed.medications || DEFAULT_MEDICATIONS,
        takenMedications: isSameDay ? parsed.takenMedications : {},
        sentNotifications: isSameDay ? (parsed.sentNotifications || []) : [],
        currentReport: isSameDay ? parsed.currentReport : {
          date: today, healthRating: 0, painLevel: 0, sleepQuality: '', appetite: '', symptoms: [], notes: '',
          systolicBP: 0, diastolicBP: 0, bloodSugar: 0, oxygenLevel: 0, heartRate: 0, waterIntake: 0, mood: ''
        }
      };
    }
    
    return {
      patientName: "المستخدم العزيز",
      patientAge: 65,
      patientId: generateId(),
      caregiverMode: false,
      caregiverTargetId: null,
      medications: DEFAULT_MEDICATIONS,
      takenMedications: {},
      notificationsEnabled: false,
      sentNotifications: [],
      customReminderTimes: {},
      history: [],
      dailyReports: {},
      currentReport: {
        date: today, healthRating: 0, painLevel: 0, sleepQuality: '', appetite: '', symptoms: [], notes: '',
        systolicBP: 0, diastolicBP: 0, bloodSugar: 0, oxygenLevel: 0, heartRate: 0, waterIntake: 0, mood: ''
      }
    };
  });

  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<string | null>(null);
  const [isMedManagerOpen, setIsMedManagerOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [caregiverData, setCaregiverData] = useState<any>(null);
  const [isCaregiverLoading, setIsCaregiverLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  const lastNudgeRef = useRef<number>(0);

  useEffect(() => {
    localStorage.setItem('health_track_v6', JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    setState(prev => ({
      ...prev,
      dailyReports: {
        ...prev.dailyReports,
        [today]: {
          report: prev.currentReport,
          takenMedications: prev.takenMedications
        }
      }
    }));
  }, [state.currentReport, state.takenMedications, today]);

  useEffect(() => {
    const login = async () => {
      const user = await authenticateAnonymously();
      if (user) setIsAuthenticated(true);
    };
    login();
  }, []);

  useEffect(() => {
    if (!state.caregiverMode && db && isAuthenticated) {
      const timeoutId = setTimeout(() => {
        syncPatientData(state.patientId, {
          patientName: state.patientName,
          patientAge: state.patientAge,
          takenMedications: state.takenMedications,
          medications: state.medications,
          history: state.history,
          currentReport: state.currentReport,
          dailyReports: state.dailyReports,
          notificationsEnabled: state.notificationsEnabled
        });
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [state, isAuthenticated]);

  useEffect(() => {
    if (state.caregiverMode && state.caregiverTargetId && db && isAuthenticated) {
      setIsCaregiverLoading(true);
      const unsub = listenToPatient(state.caregiverTargetId, (data) => {
        if (data) setCaregiverData(data);
        setIsCaregiverLoading(false);
      });
      return () => unsub();
    }
  }, [state.caregiverMode, state.caregiverTargetId, isAuthenticated]);

  const isViewingCaregiver = state.caregiverMode && caregiverData;
  const activeMedications = isViewingCaregiver ? (caregiverData.medications || DEFAULT_MEDICATIONS) : state.medications;
  const activeTakenMeds = isViewingCaregiver ? (caregiverData.takenMedications || {}) : state.takenMedications;
  const activeReport = isViewingCaregiver ? (caregiverData.currentReport || {}) : state.currentReport;
  const activeName = isViewingCaregiver ? caregiverData.patientName : state.patientName;
  const activeDailyReports = isViewingCaregiver ? (caregiverData.dailyReports || {}) : state.dailyReports;

  const toggleMedication = (id: string) => {
    if (state.caregiverMode) return;
    const med = activeMedications.find(m => m.id === id);
    const isCurrentlyTaken = state.takenMedications[id];
    if (med?.isCritical && isCurrentlyTaken) {
      if (!window.confirm(`دواء "${med.name}" ضروري جداً. هل أنت متأكد من التراجع؟`)) return;
    }
    setState(prev => {
      const isTaken = !prev.takenMedications[id];
      const log = {
        date: new Date().toLocaleDateString('ar-EG'),
        action: isTaken ? '✅ تناول الجرعة' : '🔄 تراجع عن الجرعة',
        details: med?.name || id,
        timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      };
      return {
        ...prev,
        takenMedications: { ...prev.takenMedications, [id]: isTaken },
        history: [log, ...prev.history].slice(0, 30)
      };
    });
  };

  const updateReport = (updates: Partial<HealthReport>) => {
    if (state.caregiverMode) return;
    setState(prev => ({ ...prev, currentReport: { ...prev.currentReport, ...updates } }));
  };

  const handleAI = async () => {
    setIsAnalyzing(true);
    setAiResult(null);
    try {
      const dataToAnalyze = isViewingCaregiver ? { ...state, medications: activeMedications, currentReport: activeReport, takenMedications: activeTakenMeds } : state;
      const res = await analyzeHealthStatus(dataToAnalyze);
      setAiResult(res);
      await speakText(res.summary);
    } catch (e) {
      alert("عذراً، لم نتمكن من تحليل الحالة حالياً.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(state.patientId);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const totalMeds = activeMedications.length;
  const takenCount = Object.values(activeTakenMeds).filter(Boolean).length;
  const progress = totalMeds > 0 ? (takenCount / totalMeds) * 100 : 0;
  const currentHour = new Date().getHours();

  const renderCalendar = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} className="h-12 w-12"></div>);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hasData = activeDailyReports[dateStr];
      const isToday = dateStr === today;
      let statusColor = 'bg-white text-slate-400';
      if (hasData) {
        const medsCount = Object.values(hasData.takenMedications || {}).filter(Boolean).length;
        if (medsCount === totalMeds && totalMeds > 0) statusColor = 'bg-emerald-500 text-white';
        else if (medsCount > 0) statusColor = 'bg-amber-400 text-white';
        else statusColor = 'bg-slate-200 text-slate-600';
      }
      if (isToday) statusColor += ' ring-2 ring-blue-600 ring-offset-2';
      days.push(
        <button key={d} onClick={() => setSelectedCalendarDay(dateStr)} className={`h-12 w-12 rounded-2xl flex items-center justify-center font-black text-sm transition-all hover:scale-110 ${statusColor}`}>
          {d}
        </button>
      );
    }
    return days;
  };

  return (
    <div className="min-h-screen max-w-4xl mx-auto px-4 py-8 md:py-12 space-y-8 pb-32">
      {state.caregiverMode && (
        <div className={`px-6 py-3 rounded-2xl flex items-center justify-between shadow-lg text-white transition-all duration-500 ${isCaregiverLoading ? 'bg-amber-500' : 'bg-emerald-600'}`}>
          <div className="flex items-center gap-3">
            {isCaregiverLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Wifi className="w-5 h-5 animate-pulse" />}
            <span className="font-black text-sm">{isCaregiverLoading ? 'جاري التحميل...' : 'اتصال مباشر نشط'}</span>
          </div>
          <button onClick={() => sendNudge(state.caregiverTargetId!, "برجاء مراجعة أدويتك")} className="bg-white/20 px-4 py-1.5 rounded-full text-xs font-bold hover:bg-white/30">تنبيه المريض</button>
        </div>
      )}

      <header className={`glass-card rounded-[2.5rem] p-6 md:p-10 shadow-xl border-b-[8px] relative overflow-hidden transition-all duration-500 ${state.caregiverMode ? 'border-emerald-500' : 'border-blue-600'}`}>
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
          <div className="text-right flex items-center gap-4">
            <div className={`p-4 rounded-3xl text-white shadow-lg pulse-active transition-colors ${state.caregiverMode ? 'bg-emerald-500' : 'bg-blue-600'}`}>
              {state.caregiverMode ? <UserCheck className="w-8 h-8" /> : <Heart className="w-8 h-8 fill-current" />}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 leading-tight">{activeName}</h1>
              <p className="text-slate-500 font-bold">{state.caregiverMode ? 'مراقبة حالة المريض' : 'متابعة الصحة اليومية'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setIsCalendarOpen(true)} className="p-3 bg-white rounded-2xl shadow-sm border hover:bg-slate-50 transition-all">
              <CalendarIcon className="w-6 h-6 text-slate-600" />
            </button>
            <button onClick={() => setIsSettingsOpen(true)} className="p-3 bg-white rounded-2xl shadow-sm border hover:bg-slate-50 transition-all">
              <Settings className="w-6 h-6 text-slate-600" />
            </button>
          </div>
        </div>
        <div className="mt-8 space-y-2">
          <div className="flex justify-between items-end text-xs font-black text-slate-400">
            <span>{Math.round(progress)}% مكتمل</span>
            <span>{takenCount} من {totalMeds}</span>
          </div>
          <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner">
            <div className={`h-full transition-all duration-1000 ${state.caregiverMode ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section className="glass-card rounded-[2.5rem] p-6 md:p-8 shadow-lg">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                <ClipboardList className={`w-7 h-7 ${state.caregiverMode ? 'text-emerald-500' : 'text-blue-600'}`} /> جدول الأدوية
              </h2>
            </div>
            <div className="space-y-12">
              {(Object.keys(TIME_SLOT_CONFIG) as TimeSlot[]).map(slot => {
                const meds = activeMedications.filter(m => m.timeSlot === slot);
                if (meds.length === 0) return null;
                const config = TIME_SLOT_CONFIG[slot];
                const slotHour = SLOT_HOURS[slot];
                return (
                  <div key={slot} className="relative">
                    <div className="flex items-center gap-3 mb-6">
                      <div className={`p-2.5 rounded-2xl ${config.color.split(' ')[0]} shadow-sm`}>
                        {React.cloneElement(config.icon as React.ReactElement<any>, { className: "w-5 h-5 text-slate-700" })}
                      </div>
                      <h3 className="text-sm font-black text-slate-700">{config.label}</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      {meds.map(med => {
                        const isLate = !activeTakenMeds[med.id] && currentHour >= slotHour;
                        return (
                          <button key={med.id} onClick={() => toggleMedication(med.id)} disabled={state.caregiverMode} className={`w-full text-right p-5 rounded-3xl border-2 transition-all flex items-center gap-5 relative overflow-hidden ${activeTakenMeds[med.id] ? 'bg-slate-50 border-slate-100 opacity-60' : isLate ? 'late-med-alert border-red-200 bg-red-50/30 shake-on-late' : 'bg-white border-slate-100 hover:border-blue-200'}`}>
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all shadow-sm ${activeTakenMeds[med.id] ? (state.caregiverMode ? 'bg-emerald-500' : 'bg-green-500') + ' text-white' : isLate ? 'bg-red-600 text-white scale-110 shadow-red-200' : 'bg-slate-100 text-slate-300'}`}>
                              {activeTakenMeds[med.id] ? <CheckCircle className="w-8 h-8" /> : isLate ? <AlertCircle className="w-8 h-8" /> : <Plus className="w-6 h-6" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className={`text-base font-black truncate ${activeTakenMeds[med.id] ? 'line-through text-slate-400' : isLate ? 'text-red-900' : 'text-slate-800'}`}>{med.name}</h4>
                              <p className={`text-[11px] font-bold mt-1 ${isLate ? 'text-red-600' : 'text-slate-500'}`}>{med.dosage} • {med.notes}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
        <div className="space-y-8">
          <section className="bg-slate-900 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
            <h2 className="text-xl font-black flex items-center gap-3 mb-6"><BrainCircuit className="w-8 h-8 text-blue-400" /> تحليل جيميناي</h2>
            <button onClick={handleAI} disabled={isAnalyzing} className={`w-full py-4 rounded-2xl font-black shadow-xl flex items-center justify-center gap-2 transition-all hover:scale-105 ${state.caregiverMode ? 'bg-emerald-600' : 'bg-blue-600'}`}>
              {isAnalyzing ? <RefreshCw className="animate-spin" /> : <Activity />} {isAnalyzing ? 'جاري التحليل...' : 'اطلب تقرير شامل'}
            </button>
            {aiResult && (
              <div className="mt-6 p-4 bg-white/5 rounded-2xl border border-white/10 text-xs text-slate-200">
                <p className="font-bold mb-2 text-blue-300">الملخص:</p>
                {aiResult.summary}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setIsSettingsOpen(false)} className="absolute top-6 left-6 p-2 hover:bg-slate-100 rounded-full"><X /></button>
            <h2 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-3"><Settings className="text-blue-600" /> الإعدادات</h2>
            <div className="space-y-6">
              <div className="p-6 bg-blue-50 rounded-[2rem] border border-blue-100 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-blue-400 uppercase">كود التعريف الخاص بك</label>
                  {isCopied && <span className="text-[10px] font-bold text-emerald-600 animate-bounce">تم النسخ!</span>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 p-4 bg-white rounded-2xl border-2 border-blue-200 text-center font-black tracking-widest text-2xl text-blue-700 shadow-sm">
                    {state.patientId}
                  </div>
                  <button onClick={copyToClipboard} className="p-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-colors shadow-md">
                    <Copy className="w-6 h-6" />
                  </button>
                </div>
                <p className="text-[10px] font-bold text-blue-400 text-center">أعطِ هذا الكود للمرافق ليتمكن من متابعة حالتك</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase">اسم المستخدم</label>
                <input type="text" value={state.patientName} onChange={(e) => setState(prev => ({ ...prev, patientName: e.target.value }))} placeholder="اسم المستخدم" className="w-full p-4 bg-slate-50 border-2 rounded-2xl font-black outline-none focus:border-blue-500" />
              </div>
              
              <div className="space-y-4">
                <label className="text-xs font-black text-slate-400 uppercase">نوع الحساب</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
                  <button onClick={() => setState(prev => ({ ...prev, caregiverMode: false }))} className={`flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm transition-all ${!state.caregiverMode ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
                    <Heart className="w-4 h-4" /> مريض
                  </button>
                  <button onClick={() => setState(prev => ({ ...prev, caregiverMode: true }))} className={`flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm transition-all ${state.caregiverMode ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>
                    <UserCheck className="w-4 h-4" /> مرافق
                  </button>
                </div>
              </div>

              {state.caregiverMode && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="text-xs font-black text-slate-400 uppercase">كود المريض للمتابعة</label>
                  <div className="relative">
                    <input type="text" value={state.caregiverTargetId || ""} onChange={(e) => setState(prev => ({ ...prev, caregiverTargetId: e.target.value.toUpperCase() }))} className="w-full p-4 bg-white border-2 border-emerald-100 rounded-2xl text-center font-black tracking-widest text-xl focus:border-emerald-500 outline-none" placeholder="ABC123" />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500"><ShieldCheck className="w-5 h-5" /></div>
                  </div>
                </div>
              )}
              
              <button onClick={() => setIsSettingsOpen(false)} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-lg hover:bg-blue-700 transition-colors">حفظ وإغلاق</button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Footer */}
      <footer className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-white/90 backdrop-blur-xl border border-white/50 p-2 rounded-full shadow-2xl z-50 flex items-center justify-around">
        <button onClick={() => setIsReportOpen(true)} className="p-3 text-blue-600 hover:scale-110 transition-transform"><Stethoscope /></button>
        <button onClick={handleAI} disabled={isAnalyzing} className={`p-4 rounded-full text-white shadow-lg hover:scale-110 transition-all ${state.caregiverMode ? 'bg-emerald-600' : 'bg-blue-600'}`}>
          {isAnalyzing ? <RefreshCw className="animate-spin" /> : <BrainCircuit />}
        </button>
        <button onClick={() => setIsCalendarOpen(true)} className="p-3 text-slate-500 hover:scale-110 transition-transform"><CalendarIcon /></button>
        <button onClick={stopSpeech} className="p-3 text-red-500 hover:scale-110 transition-transform"><VolumeX /></button>
      </footer>

      {/* Calendar History Modal */}
      {isCalendarOpen && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <div className="bg-white w-full max-w-lg rounded-[3rem] p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setIsCalendarOpen(false)} className="absolute top-6 left-6 p-2 hover:bg-slate-100 rounded-full"><X /></button>
            <h2 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-3"><CalendarIcon className="text-blue-600" /> تاريخ الصحة</h2>
            <div className="grid grid-cols-7 gap-2 text-center mb-6">
              {['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'].map(d => <span key={d} className="text-[10px] font-black text-slate-400 uppercase">{d}</span>)}
              {renderCalendar()}
            </div>
            {selectedCalendarDay && activeDailyReports[selectedCalendarDay] ? (
              <div className="mt-8 p-6 bg-slate-50 rounded-[2rem] border border-slate-100 animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-black text-slate-800">{selectedCalendarDay}</h3>
                  <button onClick={() => setSelectedCalendarDay(null)} className="text-xs font-bold text-blue-600">إغلاق التفاصيل</button>
                </div>
                <div className="space-y-6 text-right">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                      <p className="text-[10px] text-slate-400 font-bold mb-1">الضغط</p>
                      <p className="font-black text-slate-800">{activeDailyReports[selectedCalendarDay].report.systolicBP || '--'}/{activeDailyReports[selectedCalendarDay].report.diastolicBP || '--'}</p>
                    </div>
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                      <p className="text-[10px] text-slate-400 font-bold mb-1">السكر</p>
                      <p className="font-black text-slate-800">{activeDailyReports[selectedCalendarDay].report.bloodSugar || '--'} mg/dL</p>
                    </div>
                  </div>
                  {activeDailyReports[selectedCalendarDay].report.notes && (
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                      <p className="text-[10px] text-slate-400 font-bold mb-1">ملاحظات إضافية</p>
                      <p className="text-xs font-bold text-slate-700">{activeDailyReports[selectedCalendarDay].report.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : selectedCalendarDay && (
              <div className="mt-8 p-10 text-center text-slate-400 bg-slate-50 rounded-3xl font-bold">لا توجد بيانات مسجلة لهذا اليوم</div>
            )}
          </div>
        </div>
      )}

      {/* Health Report Modal */}
      {isReportOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <div className="bg-white w-full max-w-lg rounded-[3rem] p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setIsReportOpen(false)} className="absolute top-6 left-6 p-2 hover:bg-slate-100 rounded-full"><X /></button>
            <h2 className="text-2xl font-black text-slate-800 mb-6 flex items-center gap-3"><Stethoscope className="text-blue-600" /> تقرير الصحة اليومي</h2>
            <div className="space-y-8">
              <section className="space-y-4 text-right">
                <h3 className="text-sm font-black text-slate-400 flex items-center gap-2 uppercase tracking-widest justify-end"><Info className="w-4 h-4" /> ما الذي تشعر به؟</h3>
                <div className="flex flex-wrap gap-2 justify-end">
                  {SYMPTOMS.map(s => (
                    <button key={s} onClick={() => {const next = state.currentReport.symptoms.includes(s) ? state.currentReport.symptoms.filter(sym => sym !== s) : [...state.currentReport.symptoms, s]; updateReport({ symptoms: next });}} className={`px-4 py-2 rounded-2xl text-xs font-black border-2 transition-all ${state.currentReport.symptoms.includes(s) ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>{s}</button>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-black text-slate-400 flex items-center gap-2 uppercase tracking-widest justify-end"><Heart className="w-4 h-4" /> المؤشرات الحيوية</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 text-right">
                    <label className="text-xs font-bold text-slate-600">الضغط الانقباضي</label>
                    <input type="number" value={state.currentReport.systolicBP || ''} onChange={(e) => updateReport({ systolicBP: parseInt(e.target.value) })} className="w-full p-3 bg-slate-50 border rounded-xl font-bold focus:border-blue-500 outline-none text-right" placeholder="120" />
                  </div>
                  <div className="space-y-2 text-right">
                    <label className="text-xs font-bold text-slate-600">الضغط الانبساطي</label>
                    <input type="number" value={state.currentReport.diastolicBP || ''} onChange={(e) => updateReport({ diastolicBP: parseInt(e.target.value) })} className="w-full p-3 bg-slate-50 border rounded-xl font-bold focus:border-blue-500 outline-none text-right" placeholder="80" />
                  </div>
                  <div className="space-y-2 text-right">
                    <label className="text-xs font-bold text-slate-600 flex items-center gap-1 justify-end"><Wind className="w-3 h-3" /> نسبة الأكسجين (%)</label>
                    <input type="number" value={state.currentReport.oxygenLevel || ''} onChange={(e) => updateReport({ oxygenLevel: parseInt(e.target.value) })} className="w-full p-3 bg-slate-50 border rounded-xl font-bold focus:border-blue-400 outline-none text-right" placeholder="98" />
                  </div>
                  <div className="space-y-2 text-right">
                    <label className="text-xs font-bold text-slate-600 flex items-center gap-1 justify-end"><Thermometer className="w-3 h-3" /> سكر الدم (mg/dL)</label>
                    <input type="number" value={state.currentReport.bloodSugar || ''} onChange={(e) => updateReport({ bloodSugar: parseInt(e.target.value) })} className="w-full p-3 bg-slate-50 border rounded-xl font-bold focus:border-emerald-500 outline-none text-right" placeholder="100" />
                  </div>
                </div>
              </section>
              
              <section className="space-y-4 text-right">
                <h3 className="text-sm font-black text-slate-400 flex items-center gap-2 uppercase tracking-widest justify-end"><PenTool className="w-4 h-4" /> ملاحظات إضافية</h3>
                <textarea 
                  value={state.currentReport.notes || ''} 
                  onChange={(e) => updateReport({ notes: e.target.value })}
                  placeholder="اكتب هنا أي ملاحظات أخرى تود إضافتها عن حالتك الصحية اليوم..."
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-[2rem] font-bold text-sm min-h-[120px] focus:border-blue-500 outline-none transition-all resize-none text-right"
                />
              </section>

              <button onClick={() => setIsReportOpen(false)} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-lg hover:bg-blue-700 transition-colors">حفظ التقرير وإغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
