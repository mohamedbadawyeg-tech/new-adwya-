
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MEDICATIONS as DEFAULT_MEDICATIONS, TIME_SLOT_CONFIG, SLOT_HOURS, SYMPTOMS, CATEGORY_COLORS } from './constants';
import { AppState, TimeSlot, AIAnalysisResult, HealthReport, Medication, DayHistory } from './types';
import { analyzeHealthStatus } from './services/geminiService';
import { speakText, stopSpeech } from './services/audioService';
import { syncPatientData, listenToPatient, sendNudge, db, messaging, authenticateAnonymously } from './services/firebaseService';
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
  Plus,
  Stethoscope,
  Info,
  AlertCircle,
  UserCheck,
  Wifi,
  Calendar as CalendarIcon,
  Copy,
  Wind,
  Thermometer,
  ChevronRight,
  PenTool,
  Trash2,
  Pencil,
  VolumeX,
  PlusCircle,
  Clock,
  Bell,
  Tag,
  Stethoscope as DoctorIcon,
  ChevronLeft,
  AlertTriangle,
  Layers,
  Phone
} from 'lucide-react';

const generateId = () => Math.random().toString(36).substr(2, 6).toUpperCase();

const App: React.FC = () => {
  const today = new Date().toISOString().split('T')[0];
  
  const [now, setNow] = useState(new Date());
  const [activeNudgeAlert, setActiveNudgeAlert] = useState<{message: string, timestamp: number} | null>(null);

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
  const [caregiverData, setCaregiverData] = useState<any>(null);
  const [isCaregiverLoading, setIsCaregiverLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isMedManagerOpen, setIsMedManagerOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<Partial<Medication> | null>(null);
  const [medForReminder, setMedForReminder] = useState<Medication | null>(null);
  
  const lastNudgeRef = useRef<number>(0);
  const seenNudgeTimestampRef = useRef<number>(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

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
          customReminderTimes: state.customReminderTimes
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

  // Handle Caregiver Alerts
  useEffect(() => {
    if (state.caregiverMode && caregiverData?.lastNudge) {
      const nudge = caregiverData.lastNudge;
      // Only show if nudge is recent (within 5 minutes) and not seen yet
      const isRecent = Date.now() - nudge.timestamp < 300000;
      if (isRecent && nudge.timestamp > seenNudgeTimestampRef.current) {
        setActiveNudgeAlert(nudge);
        seenNudgeTimestampRef.current = nudge.timestamp;
        speakText(`تنبيه عاجل: ${nudge.message}`);
      }
    }
  }, [caregiverData?.lastNudge, state.caregiverMode]);

  const isViewingCaregiver = state.caregiverMode && caregiverData;
  const activeMedications = isViewingCaregiver ? (caregiverData.medications || DEFAULT_MEDICATIONS) : state.medications;
  const activeTakenMeds = isViewingCaregiver ? (caregiverData.takenMedications || {}) : state.takenMedications;
  const activeReport = isViewingCaregiver ? (caregiverData.currentReport || {}) : state.currentReport;
  const activeName = isViewingCaregiver ? caregiverData.patientName : state.patientName;
  const activeDailyReports = isViewingCaregiver ? (caregiverData.dailyReports || {}) : state.dailyReports;
  const activeReminderTimes = isViewingCaregiver ? (caregiverData.customReminderTimes || {}) : state.customReminderTimes;

  const currentHour = now.getHours();

  useEffect(() => {
    if (state.caregiverMode) return;
    
    const checkCriticalMeds = () => {
      const lateCriticalMeds = activeMedications.filter(m => 
        m.isCritical && 
        !activeTakenMeds[m.id] && 
        currentHour >= SLOT_HOURS[m.timeSlot]
      );

      if (lateCriticalMeds.length > 0) {
        const nowMs = Date.now();
        // Prevent notification flood: once per hour
        if (nowMs - lastNudgeRef.current > 3600000) {
          sendNudge(state.patientId, `المريض لم يتناول الأدوية الحرجة: ${lateCriticalMeds.map(m => m.name).join(', ')}`);
          lastNudgeRef.current = nowMs;
        }
      }
    };

    const interval = setInterval(checkCriticalMeds, 60000); // Check every minute for real-time reporting
    checkCriticalMeds();
    return () => clearInterval(interval);
  }, [activeMedications, activeTakenMeds, currentHour, state.caregiverMode, state.patientId]);

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

  const saveMedication = (med: Partial<Medication>) => {
    const updatedMeds = med.id 
      ? activeMedications.map(m => m.id === med.id ? med : m)
      : [...activeMedications, { ...med, id: generateId(), frequencyLabel: TIME_SLOT_CONFIG[med.timeSlot as TimeSlot]?.label || '' }];

    if (state.caregiverMode && state.caregiverTargetId) {
      syncPatientData(state.caregiverTargetId, { medications: updatedMeds });
    } else {
      setState(prev => ({ ...prev, medications: updatedMeds as Medication[] }));
    }
    setEditingMed(null);
  };

  const deleteMedication = (id: string) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا الدواء نهائياً؟")) return;
    const updatedMeds = activeMedications.filter(m => m.id !== id);
    if (state.caregiverMode && state.caregiverTargetId) {
      syncPatientData(state.caregiverTargetId, { medications: updatedMeds });
    } else {
      setState(prev => ({ ...prev, medications: updatedMeds }));
    }
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
  const takenCount = activeMedications.filter(m => activeTakenMeds[m.id]).length;
  const progress = totalMeds > 0 ? (takenCount / totalMeds) * 100 : 0;

  const renderCalendar = () => {
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} className="h-10 w-10 md:h-12 md:w-12"></div>);
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
        <button key={d} onClick={() => setSelectedCalendarDay(dateStr)} className={`h-10 w-10 md:h-12 md:w-12 rounded-2xl flex items-center justify-center font-black text-sm transition-all hover:scale-110 shadow-sm ${statusColor}`}>
          {d}
        </button>
      );
    }
    return days;
  };

  const getCategoryName = (cat?: string) => {
    switch(cat) {
      case 'pressure': return 'ضغط دم';
      case 'diabetes': return 'سكري';
      case 'blood-thinner': return 'سيولة';
      case 'antibiotic': return 'مضاد حيوي';
      case 'stomach': return 'معدة';
      default: return 'أخرى';
    }
  };

  return (
    <div className="min-h-screen max-w-6xl mx-auto px-4 py-8 md:py-12 space-y-10 pb-40">
      {state.caregiverMode && (
        <div className={`px-6 py-4 rounded-3xl flex items-center justify-between shadow-xl text-white transition-all duration-700 ${isCaregiverLoading ? 'bg-amber-500' : 'bg-emerald-600'}`}>
          <div className="flex items-center gap-4">
            <div className="p-2 bg-white/20 rounded-xl">
              {isCaregiverLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Wifi className="w-6 h-6 animate-pulse" />}
            </div>
            <div>
              <span className="font-black text-sm block leading-none">{isCaregiverLoading ? 'جاري المزامنة...' : 'بث مباشر نشط'}</span>
              <span className="text-[10px] opacity-80 font-bold">المرافق: {state.patientName}</span>
            </div>
          </div>
          {caregiverData?.lastNudge && (
            <div className="bg-white/20 px-4 py-2 rounded-2xl text-xs font-black animate-pulse flex items-center gap-2">
              <Bell className="w-4 h-4"/> {caregiverData.lastNudge.message}
            </div>
          )}
        </div>
      )}

      {/* Hero Header Card */}
      <header className={`glass-card rounded-[3.5rem] p-8 md:p-12 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] border-b-[12px] relative overflow-hidden transition-all duration-500 ${state.caregiverMode ? 'border-emerald-500' : 'border-blue-600'}`}>
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-blue-100/50 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-100/30 rounded-full blur-3xl"></div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
          <div className="text-right flex items-center gap-6">
            <div className={`p-6 rounded-[2.5rem] text-white shadow-2xl pulse-active transition-all transform hover:rotate-3 ${state.caregiverMode ? 'bg-emerald-500 shadow-emerald-200' : 'bg-blue-600 shadow-blue-200'}`}>
              {state.caregiverMode ? <UserCheck className="w-12 h-12" /> : <Heart className="w-12 h-12 fill-current" />}
            </div>
            <div>
              <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight leading-tight mb-1">{activeName}</h1>
              <p className="text-slate-500 font-bold text-lg md:text-xl">{state.caregiverMode ? 'مراقبة الحالة الصحية الفورية' : 'مساعدك الصحي الشخصي الذكي'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex flex-col items-end px-6 py-3 bg-slate-50/80 rounded-3xl border border-slate-100 backdrop-blur-sm">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">الآن في القاهرة</span>
              <span className="text-2xl font-black text-slate-800 tabular-nums">{now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <button onClick={() => setIsCalendarOpen(true)} className="p-5 bg-white rounded-[2rem] shadow-lg border border-slate-50 hover:border-blue-200 hover:shadow-xl transition-all group">
              <CalendarIcon className="w-8 h-8 text-slate-600 group-hover:text-blue-600 transition-colors" />
            </button>
            <button onClick={() => setIsSettingsOpen(true)} className="p-5 bg-white rounded-[2rem] shadow-lg border border-slate-50 hover:border-blue-200 hover:shadow-xl transition-all group">
              <Settings className="w-8 h-8 text-slate-600 group-hover:text-blue-600 transition-colors" />
            </button>
          </div>
        </div>

        <div className="mt-12 space-y-4">
          <div className="flex justify-between items-end">
            <div className="flex items-center gap-3">
               <span className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-black shadow-lg shadow-blue-100">{Math.round(progress)}% مكتمل</span>
               {progress === 100 && <span className="text-emerald-600 text-xs font-black flex items-center gap-1"><CheckCircle className="w-4 h-4"/> يوم مثالي!</span>}
            </div>
            <span className="text-sm font-black text-slate-400 bg-slate-100 px-4 py-1.5 rounded-full">{takenCount} من {totalMeds} أدوية تم تناولها</span>
          </div>
          <div className="h-8 w-full bg-slate-100/50 rounded-[1.5rem] overflow-hidden shadow-inner border border-white/50 p-1.5">
            <div 
              className={`h-full rounded-full transition-all duration-1000 ease-out relative ${state.caregiverMode ? 'bg-emerald-500' : 'bg-blue-600'}`} 
              style={{ width: `${progress}%` }}
            >
              <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
            </div>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-10 text-right items-start">
        {/* Medication Column */}
        <div className="lg:col-span-5 order-1 space-y-12">
          <section className="bg-white rounded-[4rem] p-10 shadow-2xl border border-slate-50 relative overflow-hidden min-h-[600px]">
            <div className="absolute top-0 left-0 w-32 h-32 bg-blue-50/50 rounded-br-[5rem] -z-0"></div>
            
            <div className="flex items-center justify-between mb-12 relative z-10">
              <button 
                onClick={() => setIsMedManagerOpen(true)}
                className={`w-16 h-16 rounded-[2rem] text-white shadow-2xl transition-all hover:scale-110 active:scale-95 flex items-center justify-center transform hover:-rotate-6 ${state.caregiverMode ? 'bg-emerald-600' : 'bg-blue-600'}`}
              >
                <Plus className="w-10 h-10" />
              </button>
              <h2 className="text-4xl font-black text-slate-800 flex items-center justify-end gap-5">
                 صيدليتي <ClipboardList className={`w-12 h-12 ${state.caregiverMode ? 'text-emerald-500' : 'text-blue-600'}`} />
              </h2>
            </div>
            
            <div className="space-y-16 relative z-10">
              {(Object.keys(TIME_SLOT_CONFIG) as TimeSlot[]).map(slot => {
                const meds = activeMedications.filter(m => m.timeSlot === slot);
                if (meds.length === 0) return null;
                const config = TIME_SLOT_CONFIG[slot];
                const slotHour = SLOT_HOURS[slot];
                
                return (
                  <div key={slot} className="relative">
                    <div className="flex items-center justify-end gap-5 mb-8 sticky top-0 bg-white/95 backdrop-blur-md py-4 z-20 border-b-2 border-slate-50 px-2">
                      <div className="text-right">
                        <h3 className="text-lg font-black text-slate-800 tracking-tight">{config.label}</h3>
                        <p className="text-[11px] font-bold text-slate-400 mt-0.5">الموعد: {slotHour}:00</p>
                      </div>
                      <div className={`p-4 rounded-[1.8rem] ${config.color.split(' ')[0]} shadow-xl border-4 border-white ring-4 ring-slate-50 transform hover:scale-110 transition-transform`}>
                        {React.cloneElement(config.icon as React.ReactElement<any>, { className: "w-7 h-7 text-slate-800" })}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-8 pr-6 border-r-4 border-slate-50">
                      {meds.map(med => {
                        const isTaken = !!activeTakenMeds[med.id];
                        const isLate = !isTaken && currentHour >= slotHour;
                        const customReminder = activeReminderTimes[med.id];
                        const categoryColor = CATEGORY_COLORS[med.category || 'other'];

                        return (
                          <div 
                            key={med.id} 
                            className={`group relative rounded-[3rem] border-2 transition-all duration-700 transform hover:translate-y-[-4px] ${
                              isTaken 
                                ? 'bg-slate-50 border-slate-100 shadow-none opacity-60 grayscale-[0.4]' 
                                : isLate 
                                  ? 'late-med-alert border-red-400 bg-red-50/10 shadow-2xl shake-on-late' 
                                  : 'bg-white border-slate-100 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.08)] hover:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.12)] hover:border-blue-200'
                            }`}
                          >
                            <div className="p-7 flex items-center gap-6">
                              {/* Left Controls */}
                              <div className="flex flex-col gap-4 shrink-0">
                                <button 
                                  onClick={() => toggleMedication(med.id)} 
                                  disabled={state.caregiverMode}
                                  className={`w-18 h-18 rounded-[2rem] flex items-center justify-center transition-all duration-500 shadow-2xl relative overflow-hidden ${
                                    isTaken 
                                      ? (state.caregiverMode ? 'bg-emerald-500' : 'bg-green-500') + ' text-white scale-90 rotate-12 shadow-green-100' 
                                      : isLate 
                                        ? 'bg-red-600 text-white shadow-red-200 scale-110 animate-bounce-short' 
                                        : 'bg-slate-50 text-slate-400 hover:bg-blue-600 hover:text-white hover:scale-105 active:scale-90'
                                  }`}
                                >
                                  {isTaken ? <CheckCircle className="w-12 h-12" /> : isLate ? <AlertTriangle className="w-11 h-11" /> : <Plus className="w-10 h-10" />}
                                  {!isTaken && !isLate && <div className="absolute inset-0 bg-white/10 translate-y-[100%] group-hover:translate-y-0 transition-transform duration-500"></div>}
                                </button>
                                
                                <button 
                                  onClick={() => setMedForReminder(med)}
                                  className={`w-18 h-12 rounded-[1.5rem] flex items-center justify-center transition-all duration-300 ${
                                    customReminder 
                                      ? 'bg-blue-600 text-white shadow-xl shadow-blue-100' 
                                      : 'bg-slate-50 text-slate-400 hover:bg-blue-100 hover:text-blue-600'
                                  }`}
                                  title="تنبيه مخصص"
                                >
                                  {customReminder ? <span className="text-xs font-black">{customReminder}</span> : <Clock className="w-6 h-6" />}
                                </button>
                              </div>

                              {/* Info Content */}
                              <div className="flex-1 text-right min-w-0 py-2">
                                <div className="flex flex-wrap items-center justify-end gap-2.5 mb-2.5">
                                  {isLate && !isTaken && (
                                    <span className="flex items-center gap-1.5 bg-red-100 text-red-700 text-[10px] font-black px-4 py-1.5 rounded-full border border-red-200">
                                      تأخر الموعد <Clock className="w-4 h-4"/>
                                    </span>
                                  )}
                                  {med.isCritical && (
                                    <span className="flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-black px-4 py-1.5 rounded-full shadow-lg shadow-red-100 animate-pulse">
                                      هام جداً <AlertTriangle className="w-4 h-4"/>
                                    </span>
                                  )}
                                  <h4 className={`text-xl font-black tracking-tight truncate ${isTaken ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                    {med.name}
                                  </h4>
                                </div>
                                
                                <p className={`text-lg font-bold mb-5 ${isTaken ? 'text-slate-400' : isLate ? 'text-red-600' : 'text-slate-600'}`}>
                                  {med.dosage}
                                </p>
                                
                                <div className="flex flex-wrap gap-3 justify-end">
                                  {med.category && (
                                    <span className={`text-[11px] font-black px-4 py-2 rounded-2xl bg-white border shadow-sm flex items-center gap-2.5 ${categoryColor}`}>
                                      <div className={`w-2 h-2 rounded-full ${categoryColor.replace('text-', 'bg-')}`}></div>
                                      {getCategoryName(med.category)}
                                    </span>
                                  )}
                                  {med.sideEffects && med.sideEffects.length > 0 && !isTaken && (
                                    <span className="text-[11px] font-bold px-4 py-2 rounded-2xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center gap-1.5">
                                      <Info className="w-3.5 h-3.5"/> أعراض جانبية محتملة
                                    </span>
                                  )}
                                  {med.notes && (
                                    <span className="text-[11px] font-bold px-4 py-2 rounded-2xl bg-blue-50 text-blue-800 border border-blue-100 max-w-[180px] truncate">
                                      {med.notes}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            {/* Caregiver Editing Tools */}
                            {state.caregiverMode && (
                              <div className="absolute top-5 left-5 flex gap-3 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-x-[-15px] group-hover:translate-x-0 z-30">
                                <button 
                                  onClick={() => { setEditingMed(med); setIsMedManagerOpen(true); }} 
                                  className="p-4 bg-blue-600 text-white rounded-[1.5rem] shadow-2xl hover:bg-blue-700 active:scale-90 transition-all"
                                >
                                  <Pencil className="w-6 h-6"/>
                                </button>
                                <button 
                                  onClick={() => deleteMedication(med.id)} 
                                  className="p-4 bg-red-600 text-white rounded-[1.5rem] shadow-2xl hover:bg-red-700 active:scale-90 transition-all"
                                >
                                  <Trash2 className="w-6 h-6"/>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* AI and Vitals Dashboard */}
        <div className="lg:col-span-7 order-2 space-y-12 sticky top-6">
          <section className="bg-slate-900 rounded-[4rem] p-12 text-white shadow-[0_40px_100px_-20px_rgba(0,0,0,0.4)] relative overflow-hidden border-b-[15px] border-blue-600">
            <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/20 blur-[120px] rounded-full"></div>
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-600/10 blur-[100px] rounded-full"></div>
            
            <div className="flex items-center justify-between mb-12 relative z-10">
               <div className="bg-white/10 p-4 rounded-3xl backdrop-blur-xl border border-white/5">
                 <BrainCircuit className="w-14 h-14 text-blue-400" />
               </div>
               <div className="text-right">
                 <h2 className="text-4xl font-black mb-2">الذكاء الاصطناعي</h2>
                 <p className="text-slate-400 font-bold text-lg">تحليل حالة المريض {activeName}</p>
               </div>
            </div>
            
            <div className="grid grid-cols-2 gap-8 mb-12 relative z-10">
               <div className="p-10 bg-white/5 rounded-[3rem] border border-white/10 text-right backdrop-blur-md transition-all hover:bg-white/10 shadow-inner group">
                  <p className="text-xs font-black text-blue-300 mb-4 uppercase tracking-[0.2em] group-hover:text-blue-100 transition-colors">معدل الحيوية</p>
                  <div className="flex items-baseline justify-end gap-3">
                    <p className="text-6xl font-black tracking-tight">{activeReport.healthRating || '--'}</p>
                    <span className="text-lg text-slate-500 font-black">/ 10</span>
                  </div>
               </div>
               <div className="p-10 bg-white/5 rounded-[3rem] border border-white/10 text-right backdrop-blur-md transition-all hover:bg-white/10 shadow-inner group">
                  <p className="text-xs font-black text-red-400 mb-4 uppercase tracking-[0.2em] group-hover:text-red-100 transition-colors">مستوى الراحة</p>
                  <div className="flex items-baseline justify-end gap-3">
                    <p className="text-6xl font-black tracking-tight">{10 - (activeReport.painLevel || 0)}</p>
                    <span className="text-lg text-slate-500 font-black">/ 10</span>
                  </div>
               </div>
            </div>
            
            <button 
              onClick={handleAI} 
              disabled={isAnalyzing} 
              className={`w-full py-10 rounded-[3rem] font-black text-2xl shadow-[0_25px_60px_-15px_rgba(37,99,235,0.5)] flex items-center justify-center gap-6 transition-all hover:scale-[1.03] active:scale-95 relative z-10 overflow-hidden group ${state.caregiverMode ? 'bg-emerald-600' : 'bg-blue-600'}`}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>
              {isAnalyzing ? <RefreshCw className="w-10 h-10 animate-spin" /> : <Activity className="w-10 h-10" />} 
              {isAnalyzing ? 'يتم التحليل الآن...' : 'طلب تقرير صحي ذكي'}
            </button>
            
            {aiResult && (
              <div className="mt-12 space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-1000 relative z-10">
                <div className="p-12 bg-white/10 rounded-[4rem] border border-white/10 text-right backdrop-blur-xl shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-2 h-full bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]"></div>
                  <div className="flex items-center justify-end gap-5 mb-8 text-blue-300 border-b border-white/5 pb-6">
                    <span className="text-2xl font-black tracking-tight">رأي الخبير الطبي</span>
                    <Info className="w-10 h-10"/>
                  </div>
                  <p className="text-xl text-slate-100 font-medium leading-[2.2] tracking-tight">{aiResult.summary}</p>
                </div>
              </div>
            )}
          </section>

          {/* Vitals Summary Card */}
          <section className="bg-white rounded-[4rem] p-12 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.1)] grid grid-cols-2 md:grid-cols-4 gap-12 border border-slate-50 relative overflow-hidden">
              <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-slate-50 rounded-full blur-2xl"></div>
              
              <div className="text-right space-y-4 group cursor-default relative z-10">
                <div className="flex items-center justify-end gap-3 text-slate-400 group-hover:text-red-500 transition-all duration-300">
                  <p className="text-xs font-black uppercase tracking-[0.2em]">الضغط</p>
                  <Heart className="w-6 h-6"/>
                </div>
                <div className="flex items-baseline justify-end gap-1.5">
                  <p className="text-4xl font-black text-slate-900 tabular-nums">{activeReport.systolicBP || '--'}</p>
                  <span className="text-2xl text-slate-200 font-black">/</span>
                  <p className="text-4xl font-black text-slate-900 tabular-nums">{activeReport.diastolicBP || '--'}</p>
                </div>
                <div className="h-2 w-16 bg-red-100 rounded-full ml-auto group-hover:w-full transition-all duration-1000 ease-out"></div>
              </div>
              
              <div className="text-right space-y-4 group cursor-default relative z-10">
                <div className="flex items-center justify-end gap-3 text-slate-400 group-hover:text-emerald-500 transition-all duration-300">
                  <p className="text-xs font-black uppercase tracking-[0.2em]">السكر</p>
                  <Thermometer className="w-6 h-6"/>
                </div>
                <div className="flex items-baseline justify-end gap-1.5">
                  <p className="text-4xl font-black text-slate-900 tabular-nums">{activeReport.bloodSugar || '--'}</p>
                </div>
                <div className="h-2 w-16 bg-emerald-100 rounded-full ml-auto group-hover:w-full transition-all duration-1000 ease-out"></div>
              </div>
              
              <div className="text-right space-y-4 group cursor-default relative z-10">
                <div className="flex items-center justify-end gap-3 text-slate-400 group-hover:text-blue-500 transition-all duration-300">
                  <p className="text-xs font-black uppercase tracking-[0.2em]">الأكسجين</p>
                  <Wind className="w-6 h-6"/>
                </div>
                <div className="flex items-baseline justify-end gap-1.5">
                  <p className="text-4xl font-black text-slate-900 tabular-nums">{activeReport.oxygenLevel || '--'}</p>
                  <span className="text-lg font-black text-slate-300">%</span>
                </div>
                <div className="h-2 w-16 bg-blue-100 rounded-full ml-auto group-hover:w-full transition-all duration-1000 ease-out"></div>
              </div>
              
              <div className="text-right space-y-4 group cursor-default relative z-10">
                <div className="flex items-center justify-end gap-3 text-slate-400 group-hover:text-amber-500 transition-all duration-300">
                  <p className="text-xs font-black uppercase tracking-[0.2em]">النبض</p>
                  <Activity className="w-6 h-6"/>
                </div>
                <p className="text-4xl font-black text-slate-900 tabular-nums">{activeReport.heartRate || '--'}</p>
                <div className="h-2 w-16 bg-amber-100 rounded-full ml-auto group-hover:w-full transition-all duration-1000 ease-out"></div>
              </div>
          </section>
        </div>
      </main>

      {/* Emergency Nudge Modal for Caregivers */}
      {activeNudgeAlert && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-8 bg-red-600/90 backdrop-blur-3xl animate-in fade-in duration-500">
          <div className="bg-white w-full max-w-md rounded-[4rem] p-12 text-center shadow-[0_50px_100px_-20px_rgba(0,0,0,0.6)] relative animate-in zoom-in duration-300">
            <div className="w-24 h-24 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-8 animate-bounce shadow-xl">
              <AlertTriangle className="w-12 h-12"/>
            </div>
            <h2 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">تنبيه عاجل للمرافق!</h2>
            <p className="text-xl text-slate-600 mb-10 leading-relaxed font-bold">{activeNudgeAlert.message}</p>
            
            <div className="space-y-4">
              <button 
                onClick={() => setActiveNudgeAlert(null)}
                className="w-full py-6 bg-slate-900 text-white rounded-[2.5rem] font-black text-xl hover:bg-black transition-all shadow-2xl active:scale-95"
              >
                تجاهل الآن
              </button>
              <button 
                onClick={() => {
                   window.location.href = `tel:911`; // Simulated emergency call
                   setActiveNudgeAlert(null);
                }}
                className="w-full py-6 bg-red-600 text-white rounded-[2.5rem] font-black text-xl hover:bg-red-700 transition-all shadow-[0_20px_40px_-10px_rgba(239,68,68,0.5)] flex items-center justify-center gap-4 active:scale-95"
              >
                اتصال بالمريض <Phone className="w-6 h-6"/>
              </button>
            </div>
            
            <button 
              onClick={() => setActiveNudgeAlert(null)}
              className="absolute top-8 left-8 p-4 hover:bg-slate-100 rounded-2xl transition-all"
            >
              <X className="w-6 h-6"/>
            </button>
          </div>
        </div>
      )}

      {/* Persistent Bottom Nav */}
      <footer className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[94%] max-w-xl bg-white/80 backdrop-blur-3xl border border-white/50 p-5 rounded-[4rem] shadow-[0_40px_80px_-15px_rgba(0,0,0,0.3)] z-[100] flex items-center justify-around ring-1 ring-black/5">
        <button 
          onClick={() => setIsReportOpen(true)} 
          className="w-18 h-18 flex items-center justify-center rounded-[2.2rem] text-blue-600 hover:bg-blue-50 transition-all active:scale-90 group relative"
          title="تسجيل البيانات"
        >
          <DoctorIcon className="w-10 h-10 group-hover:scale-125 transition-transform duration-500"/>
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white"></div>
        </button>
        
        <button 
          onClick={handleAI} 
          disabled={isAnalyzing} 
          className={`w-24 h-24 rounded-[2.8rem] text-white shadow-[0_20px_50px_-10px_rgba(37,99,235,0.7)] transition-all hover:scale-110 active:scale-90 flex items-center justify-center border-[8px] border-white relative ${state.caregiverMode ? 'bg-emerald-600 shadow-emerald-200' : 'bg-blue-600 shadow-blue-200'}`}
        >
          {isAnalyzing ? <RefreshCw className="w-12 h-12 animate-spin" /> : <BrainCircuit className="w-14 h-14" />}
          {isAnalyzing && <div className="absolute inset-0 rounded-full border-4 border-white/30 animate-ping"></div>}
        </button>
        
        <button 
          onClick={() => setIsCalendarOpen(true)} 
          className="w-18 h-18 flex items-center justify-center rounded-[2.2rem] text-slate-500 hover:bg-slate-50 transition-all active:scale-90 group"
          title="تاريخ الالتزام"
        >
          <CalendarIcon className="w-10 h-10 group-hover:scale-125 transition-transform duration-500"/>
        </button>
        
        <button 
          onClick={stopSpeech} 
          className="w-18 h-18 flex items-center justify-center rounded-[2.2rem] text-red-500 hover:bg-red-50 transition-all active:scale-90 group"
          title="إيقاف المساعد"
        >
          <VolumeX className="w-10 h-10 group-hover:scale-125 transition-transform duration-500"/>
        </button>
      </footer>

      {/* Calendar History Modal */}
      {isCalendarOpen && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-2xl transition-all duration-500">
          <div className="bg-white w-full max-w-lg rounded-[4.5rem] p-12 md:p-16 shadow-[0_60px_120px_-20px_rgba(0,0,0,0.6)] relative max-h-[92vh] overflow-y-auto custom-scrollbar border-b-[15px] border-blue-600 scale-in-center">
            <button onClick={() => setIsCalendarOpen(false)} className="absolute top-12 left-12 p-5 hover:bg-slate-100 rounded-[2rem] transition-all active:scale-90"><X className="w-8 h-8"/></button>
            <h2 className="text-4xl font-black text-slate-900 mb-14 text-right flex items-center justify-end gap-6">التاريخ الصحي <CalendarIcon className="text-blue-600 w-14 h-14" /></h2>
            <div className="grid grid-cols-7 gap-5 text-center mb-12" dir="rtl">
              {['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'].map(d => <span key={d} className="text-sm font-black text-slate-300 uppercase tracking-widest">{d}</span>)}
              {renderCalendar()}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-6 text-xs font-black text-slate-400 border-t-2 border-slate-50 pt-10">
               <span className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-2xl">مكتمل بالكامل <div className="w-4 h-4 bg-emerald-500 rounded-full shadow-lg shadow-emerald-100"></div></span>
               <span className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-2xl">التزام جزئي <div className="w-4 h-4 bg-amber-400 rounded-full shadow-lg shadow-amber-100"></div></span>
               <span className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-2xl">لم يتم البدء <div className="w-4 h-4 bg-slate-200 rounded-full"></div></span>
            </div>
          </div>
        </div>
      )}

      {/* Health Measurements Form Modal */}
      {isReportOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-2xl transition-all duration-500">
          <div className="bg-white w-full max-w-2xl rounded-[4.5rem] p-12 md:p-16 shadow-[0_60px_120px_-20px_rgba(0,0,0,0.6)] relative max-h-[94vh] overflow-y-auto custom-scrollbar border-t-[15px] border-blue-600 scale-in-center">
            <button onClick={() => setIsReportOpen(false)} className="absolute top-12 left-12 p-5 hover:bg-slate-100 rounded-[2rem] transition-all active:scale-90"><X className="w-9 h-9"/></button>
            <div className="text-right mb-16">
               <h2 className="text-5xl font-black text-slate-900 flex items-center justify-end gap-6 mb-4">يومياتي الصحية <Stethoscope className="text-blue-600 w-16 h-16" /></h2>
               <p className="text-slate-500 font-bold text-xl leading-relaxed">ساعدنا في حماية صحتك بتسجيل قراءاتك الحيوية وأي أعراض تشعر بها بدقة.</p>
            </div>
            
            <div className="space-y-20">
              {/* Symptoms Picker */}
              <section className="space-y-10 text-right">
                <h3 className="text-base font-black text-slate-400 flex items-center justify-end gap-5 uppercase tracking-[0.3em] mb-4">ما هو شعورك اليوم؟ <Info className="w-7 h-7" /></h3>
                <div className="flex flex-wrap gap-5 justify-end">
                  {SYMPTOMS.map(s => (
                    <button 
                      key={s} 
                      onClick={() => {
                        const next = state.currentReport.symptoms.includes(s) 
                          ? state.currentReport.symptoms.filter(sym => sym !== s) 
                          : [...state.currentReport.symptoms, s]; 
                        updateReport({ symptoms: next });
                      }} 
                      className={`px-10 py-5 rounded-[2.2rem] text-lg font-black border-4 transition-all duration-500 transform ${
                        state.currentReport.symptoms.includes(s) 
                          ? 'bg-blue-600 border-blue-600 text-white shadow-[0_20px_40px_-10px_rgba(37,99,235,0.4)] scale-110' 
                          : 'bg-slate-50 border-slate-50 text-slate-500 hover:border-blue-200 hover:bg-white hover:scale-105'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </section>

              {/* Vitals Input Grid */}
              <section className="space-y-12 text-right">
                <h3 className="text-base font-black text-slate-400 flex items-center justify-end gap-5 uppercase tracking-[0.3em]">المؤشرات الحيوية <Activity className="w-7 h-7" /></h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                  <div className="space-y-5">
                    <label className="text-lg font-black text-slate-800 mr-6 block tracking-tight">ضغط الدم (Sys / Dia)</label>
                    <div className="flex gap-5">
                      <input type="number" value={state.currentReport.diastolicBP || ''} onChange={(e) => updateReport({ diastolicBP: parseInt(e.target.value) })} className="w-1/2 p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] font-black text-3xl focus:border-blue-500 focus:bg-white outline-none text-right transition-all shadow-inner hover:bg-slate-100" placeholder="80" />
                      <input type="number" value={state.currentReport.systolicBP || ''} onChange={(e) => updateReport({ systolicBP: parseInt(e.target.value) })} className="w-1/2 p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] font-black text-3xl focus:border-blue-500 focus:bg-white outline-none text-right transition-all shadow-inner hover:bg-slate-100" placeholder="120" />
                    </div>
                  </div>
                  
                  <div className="space-y-5">
                    <label className="text-lg font-black text-slate-800 mr-6 block tracking-tight flex items-center justify-end gap-3">نسبة الأكسجين <Wind className="w-6 h-6 text-blue-500" /></label>
                    <div className="relative">
                      <input type="number" value={state.currentReport.oxygenLevel || ''} onChange={(e) => updateReport({ oxygenLevel: parseInt(e.target.value) })} className="w-full p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] font-black text-3xl focus:border-blue-500 focus:bg-white outline-none text-right transition-all shadow-inner hover:bg-slate-100" placeholder="98" />
                      <span className="absolute left-8 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-300">%</span>
                    </div>
                  </div>
                  
                  <div className="space-y-5">
                    <label className="text-lg font-black text-slate-800 mr-6 block tracking-tight flex items-center justify-end gap-3">سكر الدم <Thermometer className="w-6 h-6 text-emerald-500" /></label>
                    <div className="relative">
                      <input type="number" value={state.currentReport.bloodSugar || ''} onChange={(e) => updateReport({ bloodSugar: parseInt(e.target.value) })} className="w-full p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] font-black text-3xl focus:border-blue-500 focus:bg-white outline-none text-right transition-all shadow-inner hover:bg-slate-100" placeholder="110" />
                      <span className="absolute left-8 top-1/2 -translate-y-1/2 text-sm font-black text-slate-300">mg/dL</span>
                    </div>
                  </div>
                  
                  <div className="space-y-5">
                    <label className="text-lg font-black text-slate-800 mr-6 block tracking-tight flex items-center justify-end gap-3">نبض القلب <Heart className="w-6 h-6 text-red-500" /></label>
                    <input type="number" value={state.currentReport.heartRate || ''} onChange={(e) => updateReport({ heartRate: parseInt(e.target.value) })} className="w-full p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] font-black text-3xl focus:border-blue-500 focus:bg-white outline-none text-right transition-all shadow-inner hover:bg-slate-100" placeholder="75" />
                  </div>
                </div>
              </section>

              {/* Notes Field */}
              <section className="space-y-10 text-right">
                <h3 className="text-base font-black text-slate-400 flex items-center justify-end gap-5 uppercase tracking-[0.3em]">ملاحظات إضافية <PenTool className="w-7 h-7" /></h3>
                <textarea 
                  value={state.currentReport.notes || ''} 
                  onChange={(e) => updateReport({ notes: e.target.value })}
                  className="w-full p-12 bg-slate-50 border-4 border-slate-50 rounded-[3.5rem] min-h-[250px] outline-none focus:border-blue-500 focus:bg-white text-right font-medium text-2xl leading-[2] transition-all shadow-inner hover:bg-slate-100"
                  placeholder="صِف حالتك العامة اليوم أو أي تغييرات شعرت بها..."
                />
              </section>

              <button 
                onClick={() => setIsReportOpen(false)} 
                className="w-full py-10 bg-blue-600 text-white rounded-[3.5rem] font-black text-3xl shadow-[0_40px_80px_-20px_rgba(37,99,235,0.5)] hover:bg-blue-700 active:scale-95 transition-all mb-10 transform hover:translate-y-[-5px]"
              >
                تأكيد وتسجيل التقرير الصحي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Medication Reminder Custom Modal */}
      {medForReminder && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-8 bg-slate-900/95 backdrop-blur-3xl transition-all duration-500">
          <div className="bg-white w-full max-w-sm rounded-[4.5rem] p-14 shadow-[0_60px_150px_-30px_rgba(0,0,0,0.6)] relative animate-in zoom-in duration-500 border-b-[15px] border-blue-600 scale-in-center">
            <button onClick={() => setMedForReminder(null)} className="absolute top-12 left-12 p-5 hover:bg-slate-100 rounded-[2.2rem] transition-all active:scale-90"><X className="w-8 h-8" /></button>
            <div className="text-center space-y-8 mb-12">
              <div className="w-24 h-24 bg-blue-50 rounded-[3rem] flex items-center justify-center mx-auto text-blue-600 shadow-2xl border-4 border-white rotate-6">
                <Clock className="w-12 h-12"/>
              </div>
              <div className="space-y-2">
                <h3 className="text-3xl font-black text-slate-900">تنبيه ذكي</h3>
                <p className="text-lg font-bold text-slate-500">{medForReminder.name}</p>
              </div>
            </div>
            
            <div className="space-y-12">
              <div className="relative group">
                <input 
                  type="time" 
                  className="w-full p-10 bg-slate-50 border-4 border-slate-50 rounded-[3rem] text-center font-black text-5xl focus:border-blue-500 focus:bg-white outline-none transition-all shadow-inner group-hover:shadow-2xl tabular-nums"
                  value={state.customReminderTimes[medForReminder.id] || ""}
                  onChange={(e) => {
                    const newTime = e.target.value;
                    setState(prev => ({
                      ...prev,
                      customReminderTimes: { ...prev.customReminderTimes, [medForReminder.id]: newTime }
                    }));
                  }}
                />
              </div>

              <div className="flex flex-col gap-5">
                <button 
                  onClick={() => setMedForReminder(null)}
                  className="w-full py-8 bg-blue-600 text-white rounded-[2.5rem] font-black text-2xl shadow-2xl shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all transform hover:translate-y-[-3px]"
                >
                  حفظ التنبيه الجديد
                </button>
                {state.customReminderTimes[medForReminder.id] && (
                  <button 
                    onClick={() => {
                      setState(prev => {
                        const newTimes = { ...prev.customReminderTimes };
                        delete newTimes[medForReminder.id];
                        return { ...prev, customReminderTimes: newTimes };
                      });
                      setMedForReminder(null);
                    }}
                    className="w-full py-4 text-red-500 font-black text-base hover:bg-red-50 rounded-3xl transition-all"
                  >
                    إلغاء التنبيه المخصص
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Medication Management Modal */}
      {isMedManagerOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-8 bg-slate-900/95 backdrop-blur-3xl transition-all duration-500">
          <div className="bg-white w-full max-w-xl rounded-[4.5rem] p-12 md:p-16 shadow-[0_60px_150px_-30px_rgba(0,0,0,0.6)] relative max-h-[94vh] overflow-y-auto custom-scrollbar border-t-[15px] border-blue-600 scale-in-center">
            <button onClick={() => { setIsMedManagerOpen(false); setEditingMed(null); }} className="absolute top-12 left-12 p-5 hover:bg-slate-100 rounded-[2.2rem] transition-all active:scale-90"><X className="w-9 h-9"/></button>
            <h2 className="text-4xl font-black text-slate-900 mb-16 text-right flex items-center justify-end gap-6">
              إدارة أدويتي <ClipboardList className="text-blue-600 w-16 h-16" />
            </h2>
            
            {!editingMed ? (
              <div className="space-y-10">
                <button 
                  onClick={() => setEditingMed({ name: '', dosage: '', timeSlot: 'morning-fasting', notes: '', isCritical: false, category: 'other', sideEffects: [] })}
                  className="w-full py-14 border-4 border-dashed border-slate-100 rounded-[3.5rem] flex flex-col items-center justify-center gap-6 text-slate-300 font-black hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all group overflow-hidden relative"
                >
                  <PlusCircle className="w-20 h-20 transition-transform group-hover:scale-125 duration-500" /> 
                  <span className="text-2xl">إضافة صنف دواء جديد</span>
                  <div className="absolute inset-0 bg-gradient-to-tr from-blue-50/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </button>
                <div className="space-y-6">
                  {activeMedications.map(med => (
                    <div key={med.id} className="p-10 bg-slate-50 rounded-[3rem] flex items-center justify-between border-4 border-slate-50 hover:bg-white hover:shadow-2xl hover:border-blue-100 transition-all duration-700 group relative overflow-hidden">
                      <div className="flex gap-4 relative z-10">
                        <button onClick={() => setEditingMed(med)} className="p-5 bg-blue-100 text-blue-600 rounded-[1.8rem] hover:bg-blue-600 hover:text-white transition-all transform hover:rotate-6 active:scale-90 shadow-md"><Pencil className="w-7 h-7"/></button>
                        <button onClick={() => deleteMedication(med.id)} className="p-5 bg-red-100 text-red-600 rounded-[1.8rem] hover:bg-red-600 hover:text-white transition-all transform hover:-rotate-6 active:scale-90 shadow-md"><Trash2 className="w-7 h-7"/></button>
                      </div>
                      <div className="text-right relative z-10">
                        <p className="font-black text-slate-900 text-2xl tracking-tight mb-2">{med.name}</p>
                        <p className="text-sm font-bold text-slate-400 flex items-center justify-end gap-2">{med.dosage} <div className="w-1.5 h-1.5 rounded-full bg-slate-200"></div> {TIME_SLOT_CONFIG[med.timeSlot].label}</p>
                      </div>
                      <div className="absolute top-0 right-0 w-2 h-full bg-blue-100 group-hover:bg-blue-600 transition-colors"></div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-12 animate-in fade-in slide-in-from-bottom-10">
                <div className="space-y-10 text-right">
                  <div className="space-y-4">
                    <label className="text-sm font-black text-slate-400 uppercase tracking-[0.3em] mr-6">اسم الدواء التجاري</label>
                    <input type="text" value={editingMed.name} onChange={e => setEditingMed({...editingMed, name: e.target.value})} className="w-full p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] outline-none focus:border-blue-500 focus:bg-white text-right font-black text-3xl transition-all shadow-inner hover:bg-slate-100" placeholder="مثلاً: Norvasc 5mg" />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <label className="text-sm font-black text-slate-400 uppercase tracking-[0.3em] mr-6">الجرعة المحددة</label>
                      <input type="text" value={editingMed.dosage} onChange={e => setEditingMed({...editingMed, dosage: e.target.value})} className="w-full p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] outline-none focus:border-blue-500 focus:bg-white text-right font-black text-xl transition-all shadow-inner hover:bg-slate-100" placeholder="مثلاً: قرص واحد" />
                    </div>
                    <div className="space-y-4">
                      <label className="text-sm font-black text-slate-400 uppercase tracking-[0.3em] mr-6">التصنيف الطبي</label>
                      <select 
                        value={editingMed.category || 'other'} 
                        onChange={e => setEditingMed({...editingMed, category: e.target.value as any})} 
                        className="w-full p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] outline-none focus:border-blue-500 focus:bg-white text-right font-black appearance-none transition-all shadow-inner hover:bg-slate-100"
                      >
                        <option value="pressure">ضغط الدم</option>
                        <option value="diabetes">السكري</option>
                        <option value="blood-thinner">مسيل للدم</option>
                        <option value="antibiotic">مضاد حيوي</option>
                        <option value="stomach">معدة</option>
                        <option value="other">أخرى</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-sm font-black text-slate-400 uppercase tracking-[0.3em] mr-6">موعد الجرعة الرئيسي</label>
                    <select value={editingMed.timeSlot} onChange={e => setEditingMed({...editingMed, timeSlot: e.target.value as TimeSlot})} className="w-full p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] outline-none focus:border-blue-500 focus:bg-white text-right font-black appearance-none transition-all shadow-inner hover:bg-slate-100">
                      {Object.entries(TIME_SLOT_CONFIG).map(([id, cfg]) => (
                        <option key={id} value={id}>{cfg.label}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="space-y-4">
                    <label className="text-sm font-black text-slate-400 uppercase tracking-[0.3em] mr-6">تعليمات الاستخدام</label>
                    <input type="text" value={editingMed.notes} onChange={e => setEditingMed({...editingMed, notes: e.target.value})} className="w-full p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] outline-none focus:border-blue-500 focus:bg-white text-right font-black text-xl transition-all shadow-inner hover:bg-slate-100" placeholder="مثلاً: قبل الغداء بـ 30 دقيقة" />
                  </div>

                  <div className={`flex items-center justify-end gap-8 p-10 rounded-[3.5rem] border-4 transition-all shadow-inner ${editingMed.isCritical ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-50 text-slate-500'}`}>
                    <div className="text-right">
                      <span className="text-xl font-black block mb-1">دواء حيوي (Critical)؟</span>
                      <span className="text-xs font-bold opacity-70">سيتم التنبيه بقوة في حال التأخر عن هذا الدواء.</span>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={editingMed.isCritical} 
                      onChange={e => setEditingMed({...editingMed, isCritical: e.target.checked})} 
                      className="w-12 h-12 rounded-2xl accent-red-600 cursor-pointer shadow-2xl transition-transform hover:scale-110" 
                    />
                  </div>
                </div>
                
                <div className="flex gap-8">
                   <button onClick={() => setEditingMed(null)} className="flex-1 py-8 bg-slate-100 text-slate-500 rounded-[2.8rem] font-black text-2xl hover:bg-slate-200 transition-all active:scale-95">إلغاء</button>
                   <button onClick={() => saveMedication(editingMed)} className="flex-[2] py-8 bg-blue-600 text-white rounded-[2.8rem] font-black text-2xl shadow-[0_30px_70px_-15px_rgba(37,99,235,0.4)] hover:bg-blue-700 active:scale-95 transition-all transform hover:translate-y-[-4px]">حفظ الدواء في النظام</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-900/95 backdrop-blur-3xl transition-all duration-500">
          <div className="bg-white w-full max-md rounded-[4.5rem] p-12 md:p-16 shadow-[0_60px_150px_-30px_rgba(0,0,0,0.6)] relative max-h-[94vh] overflow-y-auto custom-scrollbar border-b-[15px] border-slate-300 scale-in-center">
            <button onClick={() => setIsSettingsOpen(false)} className="absolute top-12 left-12 p-5 hover:bg-slate-100 rounded-[2.2rem] transition-all active:scale-90"><X className="w-9 h-9"/></button>
            <h2 className="text-4xl font-black text-slate-900 mb-16 text-right flex items-center justify-end gap-6">إعدادات الحساب <Settings className="text-blue-600 w-16 h-16" /></h2>
            
            <div className="space-y-12">
              <div className="p-12 bg-blue-50/70 rounded-[3.5rem] border-4 border-white shadow-2xl space-y-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-full bg-blue-600/5"></div>
                <div className="flex items-center justify-between relative z-10">
                  {isCopied && <span className="text-sm font-black text-emerald-600 animate-bounce bg-emerald-50 px-5 py-2 rounded-full border border-emerald-100 shadow-sm">تم نسخ الكود!</span>}
                  <label className="text-xs font-black text-blue-400 uppercase tracking-[0.3em]">كود المريض الفريد</label>
                </div>
                <div className="flex items-center gap-6 relative z-10">
                  <button onClick={copyToClipboard} className="w-20 h-20 bg-blue-600 text-white rounded-[2rem] hover:bg-blue-700 transition-all shadow-2xl flex items-center justify-center active:scale-90 transform hover:rotate-6">
                    <Copy className="w-9 h-9" />
                  </button>
                  <div className="flex-1 p-8 bg-white rounded-[2.2rem] border-2 border-blue-200 text-center font-black tracking-[0.4em] text-4xl text-blue-700 shadow-inner group">
                    <span className="group-hover:tracking-[0.5em] transition-all duration-500">{state.patientId}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 text-right">
                <label className="text-sm font-black text-slate-400 uppercase tracking-widest mr-6">اسم صاحب الحساب</label>
                <input type="text" value={state.patientName} onChange={(e) => setState(prev => ({ ...prev, patientName: e.target.value }))} className="w-full p-8 bg-slate-50 border-4 border-slate-50 rounded-[2.5rem] font-black text-2xl outline-none focus:border-blue-500 focus:bg-white text-right transition-all shadow-inner hover:bg-slate-100" />
              </div>
              
              <div className="space-y-6 text-right">
                <label className="text-sm font-black text-slate-400 uppercase tracking-widest mr-6">وضع الاستخدام</label>
                <div className="grid grid-cols-2 gap-5 p-4 bg-slate-100/50 rounded-[3.5rem] border-2 border-slate-100">
                  <button 
                    onClick={() => setState(prev => ({ ...prev, caregiverMode: true }))} 
                    className={`flex items-center justify-center gap-5 py-6 rounded-[2.8rem] font-black text-xl transition-all duration-500 ${state.caregiverMode ? 'bg-white text-emerald-600 shadow-[0_20px_40px_-10px_rgba(16,185,129,0.3)] border-2 border-emerald-50 scale-105' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    مرافق <UserCheck className="w-7 h-7" />
                  </button>
                  <button 
                    onClick={() => setState(prev => ({ ...prev, caregiverMode: false }))} 
                    className={`flex items-center justify-center gap-5 py-6 rounded-[2.8rem] font-black text-xl transition-all duration-500 ${!state.caregiverMode ? 'bg-white text-blue-600 shadow-[0_20px_40px_-10px_rgba(37,99,235,0.3)] border-2 border-blue-50 scale-105' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    مريض <Heart className="w-7 h-7" />
                  </button>
                </div>
              </div>

              {state.caregiverMode && (
                <div className="space-y-5 text-right animate-in fade-in slide-in-from-top-8 duration-700">
                  <div className="flex items-center justify-end gap-3 mr-6">
                    <span className="text-[10px] font-black text-emerald-600 uppercase">اتصال آمن</span>
                    <label className="text-sm font-black text-slate-400 uppercase tracking-widest">كود المريض للمتابعة</label>
                  </div>
                  <div className="relative group">
                    <input 
                      type="text" 
                      value={state.caregiverTargetId || ""} 
                      onChange={(e) => setState(prev => ({ ...prev, caregiverTargetId: e.target.value.toUpperCase() }))} 
                      className="w-full p-8 bg-white border-4 border-emerald-50 rounded-[3rem] text-center font-black tracking-[0.4em] text-5xl focus:border-emerald-500 outline-none shadow-2xl shadow-emerald-100/50 transition-all group-hover:scale-[1.02]" 
                      placeholder="ABC123" 
                    />
                    <div className="absolute right-10 top-1/2 -translate-y-1/2 text-emerald-500 group-hover:scale-125 transition-transform"><ShieldCheck className="w-12 h-12" /></div>
                  </div>
                </div>
              )}
              
              <button onClick={() => setIsSettingsOpen(false)} className="w-full py-9 bg-slate-900 text-white rounded-[3.2rem] font-black text-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] hover:bg-black active:scale-95 transition-all transform hover:translate-y-[-5px]">حفظ التغييرات وإغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
