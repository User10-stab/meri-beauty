"use client";

import { useCallback, useEffect, useState } from "react";
import { findNearestAvailability } from "@/actions/reservation/find-nearest-availability";
import { getAvailableSlots, getMonthAvailability } from "@/actions/reservation/get-available-slots";
import { hasReservationWindow } from "@/lib/slot-availability";
import { ChevronLeft, ChevronRight, Calendar, Clock, Euro, CalendarDays, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import CardBotanicalSprigs from "@/components/reservation/CardBotanicalSprigs";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/lib/intl-locale";

async function validateSlotAvailability(staffServiceId, date, time, t) {
  if (!staffServiceId || !date || !time) return false;
  const result = await getAvailableSlots(staffServiceId, date);
  if (!result.success) { toast.error(result.message || t("dateTime.checkAvailabilityFailed")); return false; }
  if (!result.data.isWorkingDay) {
    const msg = UNAVAILABLE_REASON_KEYS[result.data.reason] ? t(`dateTime.unavailableReasons.${UNAVAILABLE_REASON_KEYS[result.data.reason]}`) : t("dateTime.dayUnavailable");
    toast.error(msg); return false;
  }
  const ok = hasReservationWindow(result.data.reservationWindows ?? [], time);
  if (!ok) { toast.error(t("dateTime.slotUnavailable")); return false; }
  return true;
}

async function validateMultiSlotAvailability(drafts, appointments, t) {
  for (const appt of appointments) {
    const draft = drafts[appt.draftIndex];
    const staffServiceId = draft?.staffService?.id;
    const date = appt.date ? new Date(appt.date) : null;
    const time = appt.time;
    if (!date || Number.isNaN(date.getTime())) { toast.error(t("dateTime.selectDateTime")); return false; }
    const ok = await validateSlotAvailability(staffServiceId, date, time, t);
    if (!ok) return false;
  }
  return true;
}


function getDaysInMonth(date) {
  const year=date.getFullYear(); const month=date.getMonth();
  const startingDayOfWeek=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const days=[]; for(let i=0;i<startingDayOfWeek;i++) days.push(null); for(let i=1;i<=daysInMonth;i++) days.push(new Date(year,month,i)); return days;
}
function getDateKey(date){ if(!date) return null; return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;}
function isSameDay(a,b){ if(!a||!b) return false; return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();}
function isDateInPast(date){ if(!date) return true; const today=new Date(); today.setHours(0,0,0,0); return date<today;}
function formatTimeFromMinutes(m){ const h=Math.floor(m/60); const mi=m%60; return `${String(h).padStart(2,"0")}:${String(mi).padStart(2,"0")}`;}
const UNAVAILABLE_REASON_KEYS={"Staff not available":"staffNotAvailable","User deleted":"userDeleted","No working hours configured":"noWorkingHours","No active contract":"noActiveContract","Contract has not started yet":"contractNotStarted","Contract has expired":"contractExpired","Salon closed this day":"salonClosedDay","Staff not working this day":"staffNotWorkingDay","Staff on time off":"staffOnTimeOff","Salon closure":"salonClosure","Service not offered by this staff member on this day":"serviceNotOfferedThisDay"};

function CalendarWidget({ selectedDate, onDateSelect, disabledDates=new Set(), month, onMonthChange }) {
  const t = useTranslations("reservationSteps");
  const locale = useLocale();
  const [internalMonth,setInternalMonth]=useState(selectedDate??new Date());
  const currentMonth=month??internalMonth;
  const setCurrentMonth=onMonthChange??setInternalMonth;
  const days=getDaysInMonth(currentMonth);
  const isDisabled=(date)=>{ if(!date) return true; if(isDateInPast(date)) return true; return disabledDates.has(getDateKey(date));};
  return (
    <div className="mx-auto w-full max-w-full rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 p-3 shadow-[0_2px_16px_rgba(47,58,46,0.04)] sm:max-w-[320px] sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={()=>setCurrentMonth(new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1))} className="rounded-full p-1.5 hover:bg-[#f5ece0] text-[#2F3A2E] transition-colors" aria-label={t("dateTime.prevMonthAria")}><ChevronLeft size={16} /></button>
        <span className="text-sm font-semibold tracking-tight text-[#2F3A2E]">{new Intl.DateTimeFormat(toIntlLocale(locale), { month: "long", year: "numeric" }).format(currentMonth)}</span>
        <button type="button" onClick={()=>setCurrentMonth(new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1))} className="rounded-full p-1.5 hover:bg-[#f5ece0] text-[#2F3A2E] transition-colors" aria-label={t("dateTime.nextMonthAria")}><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(toIntlLocale(locale), { weekday: "short" }).format(new Date(2023, 0, index + 1)).replace(".", "")).map((day)=>(<div key={day} className="pb-1 text-center text-[10px] font-semibold tracking-wide text-[#9a9590]">{day}</div>))}
        {days.map((day,i)=>(
          <button key={i} type="button" onClick={()=>day && !isDisabled(day) && onDateSelect(day)} disabled={!day || isDisabled(day)} className={`h-8 w-full rounded-full border text-xs font-medium transition-all ${!day ? "invisible" : isDisabled(day) ? "cursor-not-allowed border-[#ede5d8] bg-[#fdf8f0] text-[#c2b8aa]" : isSameDay(day,selectedDate) ? "border-[#b89664] bg-[#b89664] text-white shadow-sm" : "border-transparent bg-white text-[#2F3A2E] hover:border-[#b89664] hover:bg-[#f5ece0]"}`}>{day?day.getDate():""}</button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-[#9a9590]"><span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#fdf8f0] border border-[#ede5d8]" /><span>{t("dateTime.unavailableDates")}</span><span className="mx-1 h-1 w-1 rounded-full bg-[#ede5d8]" /><span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#b89664]" /><span>{t("dateTime.selected")}</span></div>
    </div>
  );
}

function formatDateLabel(dateInput){ const date=new Date(dateInput); return date.toLocaleDateString("fr-FR",{weekday:"long",year:"numeric",month:"long",day:"numeric",timeZone:"Europe/Brussels"});}
function StaffChip({staff}){ const name=staff?.user?.fullName??"—"; return (<div className="flex items-center gap-2"><div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-[#ede5d8]">{staff?.photo?(<Image src={staff.photo} alt={name} fill className="object-cover" />):(<div className="flex h-full w-full items-center justify-center bg-[#2F3A2E] text-xs font-bold text-white">{name.charAt(0)}</div>)}</div><span className="text-sm font-semibold text-[#2F3A2E]">{name}</span></div>);}
function DraftSummary({drafts}){ const totalDuration=drafts.reduce((s,d)=>s+(d.duration??0),0); const totalPrice=drafts.reduce((s,d)=>s+Number(d.price??0),0); return (<div className="rounded-2xl border border-[#ede5d8]/70 bg-white p-5 shadow-sm"><h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9a9590]">Vos rendez-vous ({drafts.length})</h3><div className="space-y-3">{drafts.map((draft,i)=>(<div key={i} className="rounded-xl border border-[#ede5d8]/70 bg-[#fdf8f0]/50 p-3"><p className="text-[10px] font-semibold uppercase tracking-widest text-[#b89664]">Rendez-vous {i+1}</p><p className="mt-1 text-sm font-semibold text-[#2F3A2E]">{draft.service?.name??"—"}</p><div className="mt-1.5"><StaffChip staff={draft.staff} /></div><div className="mt-2 flex items-center justify-between text-xs text-[#6f6a64]"><span className="flex items-center gap-1"><Clock size={12}/>{draft.duration??"—"} min</span><span className="flex items-center gap-1 font-semibold text-[#2F3A2E]"><Euro size={12}/>{Number(draft.price??0).toFixed(2)}</span></div></div>))}</div><div className="mt-4 flex items-center justify-between border-t border-[#ede5d8] pt-3 text-sm font-semibold text-[#2F3A2E]"><span>Total estimé</span><span>€{totalPrice.toFixed(2)} • {totalDuration} min</span></div></div>);}
function ModeSwitcher({mode,onChange}){ const options=[{id:"same-day",label:"Même jour",sublabel:"Recommandé",description:"Tous vos rendez-vous le même jour",icon:<Calendar size={18}/>},{id:"multi-day",label:"Plusieurs jours",sublabel:null,description:"Chaque rendez-vous à une date différente",icon:<CalendarDays size={18}/>}]; return (<div className="grid grid-cols-2 gap-3">{options.map((opt)=>(<button key={opt.id} type="button" onClick={()=>onChange(opt.id)} className={`relative rounded-2xl border p-4 text-left transition-all ${mode===opt.id?"border-[#2F3A2E] bg-[#2F3A2E]/[0.04] shadow-sm":"border-[#ede5d8]/70 hover:border-[#2F3A2E]/15 bg-white"}`}>{opt.sublabel && (<span className="absolute right-3 top-3 rounded-full bg-[#2F3A2E] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{opt.sublabel}</span>)}<div className={`mb-2 ${mode===opt.id?"text-[#2F3A2E]":"text-[#9a9590]"}`}>{opt.icon}</div><p className="text-sm font-semibold text-[#2F3A2E]">{opt.label}</p><p className="mt-0.5 text-xs leading-relaxed text-[#6f6a64]">{opt.description}</p></button>))}</div>);}
function LoadingState(){ return (<div className="flex flex-col items-center justify-center gap-3 py-12 text-[#6f6a64]"><div className="h-10 w-10 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#2F3A2E]" /><p className="text-sm">Recherche des créneaux les plus proches…</p></div>);}
function TimeSlotButton({window,selected,onSelect}){ const isAvailable = window.available !== false; return (<button type="button" onClick={isAvailable ? onSelect : undefined} disabled={!isAvailable} aria-pressed={selected} className={`flex items-center justify-center rounded-xl border px-3 py-2.5 text-center transition-all ${!isAvailable?"cursor-not-allowed border-[#ede5d8] bg-[#fafafa] text-[#c2b8aa] opacity-50":selected?"border-[#b89664] bg-[#b89664] text-white shadow-sm":"border-[#ede5d8]/70 bg-white text-[#2F3A2E] hover:border-[#b89664] hover:bg-[#f5ece0]"}`}><span className="text-sm font-bold leading-tight tabular-nums">{window.startTime}</span></button>);}
function EmptyState({message}){ return (<div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-[#9a9590]"><Clock size={28} className="text-[#d9c9a8]" /><p className="text-sm max-w-xs">{message??"Aucun créneau disponible pour le moment."}</p></div>);}

function SingleProposalCard({proposal,drafts,selected,onSelect,index}){
  const draft=drafts[0]; const duration=draft?.duration??60;
  const [hours,minutes]=proposal.time.split(':').map(Number);
  const endMinutes=hours*60+minutes+duration;
  const endTime=formatTimeFromMinutes(endMinutes);
  const timeRange=`${proposal.time} → ${endTime}`;
  return (
    <button type="button" onClick={onSelect} className={`relative w-full overflow-hidden rounded-xl border-2 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 text-left transition-all ${selected?"border-[#b89664] bg-white shadow-[0_8px_28px_rgba(47,58,46,0.12)]":"border-[#ede5d8]/70 shadow-[0_2px_16px_rgba(47,58,46,0.04)] hover:-translate-y-1 hover:border-[#b89664] hover:bg-[#f5ece0] hover:shadow-[0_10px_28px_rgba(47,58,46,0.08)]"}`}>
      <CardBotanicalSprigs index={index} />
      <div className="flex items-start justify-between gap-3">
        <div>
          {proposal.recommended?(<span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[#2F3A2E] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white"><Sparkles size={10}/> Recommandé</span>):(<span className="mb-2 inline-block text-xs font-medium text-[#9a9590]">Option {index+1}</span>)}
          <p className="text-[15px] font-semibold text-[#2F3A2E]">{formatDateLabel(proposal.date)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-[#2F3A2E]"><Clock size={14} className="text-[#b89664]"/>{timeRange}</p>
        </div>
        {selected && <CheckCircle2 size={22} className="flex-shrink-0 text-[#2F3A2E]" />}
      </div>
    </button>
  );
}
function SameDayProposalCard({proposal,drafts,selected,onSelect,index}){
  return (
    <button type="button" onClick={onSelect} className={`relative w-full overflow-hidden rounded-xl border-2 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 text-left transition-all ${selected?"border-[#b89664] bg-white shadow-[0_8px_28px_rgba(47,58,46,0.12)]":"border-[#ede5d8]/70 shadow-[0_2px_16px_rgba(47,58,46,0.04)] hover:-translate-y-1 hover:border-[#b89664] hover:bg-[#f5ece0] hover:shadow-[0_10px_28px_rgba(47,58,46,0.08)]"}`}>
      <CardBotanicalSprigs index={index} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          {proposal.recommended?(<span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[#2F3A2E] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white"><Sparkles size={10}/> Recommandé</span>):(<span className="mb-2 inline-block text-xs font-medium text-[#9a9590]">Option {index+1}</span>)}
          <p className="text-[15px] font-semibold text-[#2F3A2E]">{formatDateLabel(proposal.date)}</p>
          <p className="mt-1 text-sm text-[#6f6a64]">{proposal.startTime} → {proposal.finishTime}{proposal.totalWaitingTime>0 && (<span className="text-[#9a9590]"> • {proposal.totalWaitingTime} min d&apos;attente</span>)}</p>
          <div className="mt-4 space-y-2">{proposal.appointments.map((appt)=>{ const draft=drafts[appt.draftIndex]; const duration=draft?.duration??60; const [h,m]=appt.time.split(':').map(Number); const end=formatTimeFromMinutes(h*60+m+duration); return (<div key={appt.draftIndex} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs border border-[#ede5d8]/50"><span className="font-medium text-[#2F3A2E]">{draft?.service?.name??`Rendez-vous ${appt.draftIndex+1}`}</span><span className="font-medium text-[#2F3A2E]">{appt.time} → {end}</span></div>);})}</div>
          <div className="mt-3 flex gap-4 text-xs text-[#6f6a64]"><span>{proposal.totalDuration} min de soins</span><span>{proposal.appointmentCount} rendez-vous</span></div>
        </div>
        {selected && <CheckCircle2 size={22} className="flex-shrink-0 text-[#2F3A2E]" />}
      </div>
    </button>
  );
}

function AppointmentDateCard({index,draft,selectedDate,selectedTime,onDateSelect,onTimeSelect}){
  const [open,setOpen]=useState(true);
  const [availableWindows,setAvailableWindows]=useState([]);
  const [disabledDates,setDisabledDates]=useState(new Set());
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [currentMonth,setCurrentMonth]=useState(selectedDate??new Date());
  const staffServiceId=draft.staffService?.id;
  useEffect(()=>{ if(!staffServiceId) return; getMonthAvailability(staffServiceId,currentMonth).then((r)=>{ if(r.success) setDisabledDates(new Set(r.data.unavailableDates||[]));});},[staffServiceId,currentMonth]);
  useEffect(()=>{ if(!selectedDate||!staffServiceId){ setAvailableWindows([]); return;} setLoadingSlots(true); getAvailableSlots(staffServiceId,selectedDate).then((result)=>{ if(result.success){ setAvailableWindows(result.data.allTimeSlots || result.data.reservationWindows||[]); if(!result.data.isWorkingDay && result.data.reason){ toast.error(UNAVAILABLE_REASON_MESSAGES[result.data.reason]||"Ce jour n'est pas disponible");}} else{ toast.error(result.message||"Erreur lors du chargement"); setAvailableWindows([]);} setLoadingSlots(false);});},[selectedDate,staffServiceId]);
  const isComplete=Boolean(selectedDate && selectedTime);
  return (
    <div className="overflow-hidden rounded-2xl border border-[#ede5d8]/70 bg-white shadow-sm">
      <button type="button" onClick={()=>setOpen((v)=>!v)} className="flex w-full items-center justify-between bg-[#2F3A2E] px-5 py-4">
        <div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-xs font-bold text-white">{index+1}</span><div className="text-left"><p className="text-sm font-semibold text-white">{draft.service?.name??"—"}</p><p className="text-xs text-white/70">{draft.staff?.user?.fullName??"—"}</p></div></div>
        <div className="flex items-center gap-3">{isComplete?(<span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#2F3A2E]">{selectedDate.toLocaleDateString("fr-FR",{day:"2-digit",month:"short",timeZone:"Europe/Brussels"})} • {selectedTime}</span>):selectedDate?(<span className="rounded-full bg-white/15 px-3 py-1 text-xs text-white/80">{selectedDate.toLocaleDateString("fr-FR",{day:"2-digit",month:"short",timeZone:"Europe/Brussels"})} — choisir l&apos;heure</span>):(<span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/60">Date et heure non choisies</span>)}<ChevronRight size={16} className={`text-white/60 transition-transform ${open?"rotate-90":""}`} /></div>
      </button>
      {open && (
        <div className="space-y-5 p-5 bg-[#fdf8f0]/30">
          <div className="flex items-center justify-between rounded-xl border border-[#ede5d8]/50 bg-white px-4 py-3"><StaffChip staff={draft.staff} /><div className="flex items-center gap-3 text-sm text-[#6f6a64]"><span className="flex items-center gap-1"><Clock size={14}/>{draft.duration??"—"} min</span><span className="flex items-center gap-1 font-semibold text-[#2F3A2E]"><Euro size={14}/>{Number(draft.price??0).toFixed(2)}</span></div></div>
          <div className="rounded-2xl border border-[#ede5d8]/50 bg-white p-4"><h4 className="mb-3 text-sm font-semibold text-[#2F3A2E]">Choisissez une date</h4><CalendarWidget selectedDate={selectedDate} month={currentMonth} onMonthChange={setCurrentMonth} onDateSelect={(date)=>{setCurrentMonth(new Date(date.getFullYear(),date.getMonth(),1)); onDateSelect(date);}} disabledDates={disabledDates}/>{selectedDate && (<div className="mt-3 flex items-center gap-2 rounded-full bg-[#2F3A2E] px-3 py-2 text-xs text-white"><Calendar size={13} className="text-white/70"/><span className="font-medium">{formatDateLabel(selectedDate)}</span></div>)}</div>
          <div className="rounded-2xl border border-[#ede5d8]/50 bg-white p-4"><h4 className="mb-3 text-sm font-semibold text-[#2F3A2E]">Créneaux disponibles</h4>{!selectedDate?(<div className="flex h-20 items-center justify-center text-xs text-[#9a9590]">Sélectionnez d&apos;abord une date</div>):loadingSlots?(<div className="flex h-20 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#2F3A2E]" /></div>):availableWindows.length===0?(<div className="flex h-20 items-center justify-center text-xs text-[#9a9590]">Aucun créneau disponible ce jour</div>):(<div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{availableWindows.map((window)=>(<TimeSlotButton key={window.startTime} window={window} selected={selectedTime===window.startTime} onSelect={()=>onTimeSelect(window.startTime)} />))}</div>)}</div>
        </div>
      )}
    </div>
  );
}

function MultiDayManualView({drafts,perDraftDates,perDraftTimes,onDraftDateSelect,onDraftTimeSelect}){
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 shadow-[0_2px_16px_rgba(47,58,46,0.04)]"><CardBotanicalSprigs /><h3 className="text-[15px] font-bold uppercase text-[#b89664]">Planifiez chaque rendez-vous</h3><div className="mt-4 h-px w-10 bg-[#b89664]/20" /><p className="pt-3 text-[14px] leading-relaxed text-[#232a21]">Choisissez une date et une heure pour chaque rendez-vous ci-dessous.</p></div>
      {drafts.map((draft,index)=>(<AppointmentDateCard key={index} index={index} draft={draft} selectedDate={perDraftDates[index]??null} selectedTime={perDraftTimes[index]??null} onDateSelect={(date)=>onDraftDateSelect(index,date)} onTimeSelect={(time)=>onDraftTimeSelect(index,time)} />))}
    </div>
  );
}

function SingleDraftView({draft,selectedDate,selectedTime,onDateSelect,onTimeSelect,onConfirm,validating}){
  const [disabledDates,setDisabledDates]=useState(new Set());
  const [availableWindows,setAvailableWindows]=useState([]);
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [currentMonth,setCurrentMonth]=useState(selectedDate??new Date());
  const staffServiceId=draft?.staffService?.id;
  useEffect(()=>{ if(!staffServiceId) return; getMonthAvailability(staffServiceId,currentMonth).then((r)=>{ if(r.success) setDisabledDates(new Set(r.data.unavailableDates||[]));});},[staffServiceId,currentMonth]);
  useEffect(()=>{ if(!selectedDate||!staffServiceId){ setAvailableWindows([]); return;} setLoadingSlots(true); getAvailableSlots(staffServiceId,selectedDate).then((result)=>{ if(result.success){ setAvailableWindows(result.data.allTimeSlots || result.data.reservationWindows||[]); if(!result.data.isWorkingDay && result.data.reason){ toast.error(UNAVAILABLE_REASON_MESSAGES[result.data.reason]||"Ce jour n'est pas disponible");}} else{ toast.error(result.message||"Erreur lors du chargement"); setAvailableWindows([]);} setLoadingSlots(false);});},[selectedDate,staffServiceId]);
  return (
    <div className="relative space-y-5">
      <CardBotanicalSprigs />
      <div className="relative overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 shadow-[0_2px_16px_rgba(47,58,46,0.04)]"><CardBotanicalSprigs /><h3 className="text-[15px] font-bold uppercase text-[#b89664]">Choisissez une date</h3><div className="mt-4 h-px w-10 bg-[#b89664]/20" /><div className="pt-3"><CalendarWidget selectedDate={selectedDate} month={currentMonth} onMonthChange={setCurrentMonth} onDateSelect={(date)=>{setCurrentMonth(new Date(date.getFullYear(),date.getMonth(),1)); onDateSelect(date);}} disabledDates={disabledDates}/>{selectedDate && (<div className="mt-4 flex w-fit items-center gap-2 rounded-full bg-[#b89664] px-4 py-2 text-xs text-white"><Calendar size={13} className="text-white/70"/><span className="font-medium">{formatDateLabel(selectedDate)}</span></div>)}</div></div>
      <div className="relative overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 shadow-[0_2px_16px_rgba(47,58,46,0.04)]"><CardBotanicalSprigs index={1} /><h3 className="text-[15px] font-bold uppercase text-[#b89664]">Créneaux disponibles</h3><div className="mt-4 h-px w-10 bg-[#b89664]/20" /><div className="pt-3">{!selectedDate?(<div className="flex h-24 items-center justify-center text-sm text-[#9a9590]">Sélectionnez d&apos;abord une date</div>):loadingSlots?(<div className="flex h-24 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#b89664]" /></div>):availableWindows.length===0?(<div className="flex h-24 items-center justify-center text-sm text-[#9a9590]">Aucun créneau disponible ce jour</div>):(<div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{availableWindows.map((window)=>(<TimeSlotButton key={window.startTime} window={window} selected={selectedTime===window.startTime} onSelect={()=>onTimeSelect(window.startTime)} />))}</div>)}</div></div>
      {selectedDate && selectedTime && (<button type="button" onClick={onConfirm} disabled={validating} className={`w-full rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition-all ${validating?"cursor-not-allowed bg-[#ede5d8] text-white/70":"bg-[#b89664] hover:bg-[#a38353] hover:shadow-md"}`}>{validating?(<span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin"/>Vérification en cours…</span>):"Confirmer ce créneau"}</button>)}
    </div>
  );
}

function AutoProposalView({drafts,selectedIndex,onSelect,onConfirm,validating}){
  const [loading,setLoading]=useState(true); const [proposals,setProposals]=useState([]); const [resultType,setResultType]=useState(null); const [message,setMessage]=useState(null);
  const loadProposals=useCallback(async()=>{ setLoading(true); setMessage(null); const payload=drafts.map((d)=>({staffService:{id:d.staffService.id,duration:d.duration}})); const result=await findNearestAvailability({drafts:payload,schedulingMode:"same-day"}); if(!result.success){ toast.error(result.message||"Erreur lors de la recherche"); setProposals([]);} else{ setProposals(result.proposals??[]); setResultType(result.type??null); setMessage(result.message??null);} setLoading(false);},[drafts]);
  useEffect(()=>{ loadProposals();},[loadProposals]);
  if(loading) return <LoadingState/>; if(proposals.length===0) return <EmptyState message={message}/>;
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 shadow-[0_2px_16px_rgba(47,58,46,0.04)]"><CardBotanicalSprigs /><h3 className="text-[15px] font-bold uppercase text-[#b89664]">Créneaux disponibles</h3><div className="mt-4 h-px w-10 bg-[#b89664]/20" /><p className="mb-5 pt-3 text-[14px] leading-relaxed text-[#232a21]">Nous avons trouvé les prochains créneaux disponibles. Choisissez celui qui vous convient.</p><div className="space-y-3">{resultType==="single" && proposals.map((proposal,i)=>(<SingleProposalCard key={`${proposal.date}-${proposal.time}`} proposal={proposal} drafts={drafts} index={i} selected={selectedIndex===i} onSelect={()=>onSelect(i,proposal)} />))}{resultType==="same-day" && proposals.map((proposal,i)=>(<SameDayProposalCard key={`${proposal.date}-${proposal.startTime}-${i}`} proposal={proposal} drafts={drafts} index={i} selected={selectedIndex===i} onSelect={()=>onSelect(i,proposal)} />))}</div></div>
      <div className="flex justify-end w-full">{selectedIndex!==null && (<button type="button" onClick={onConfirm} disabled={validating} className={`rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition-all ${validating?"cursor-not-allowed bg-[#ede5d8] text-white/70":"bg-[#b89664] hover:bg-[#a38353] hover:shadow-md"}`}>{validating?(<span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin"/>Vérification…</span>):"Confirmer cet horaire"}</button>)}</div>
    </div>
  );
}

export default function DateTimeStep({data,updateData,nextStep}){
  const t = useTranslations("reservationSteps");
  const locale = useLocale();
  const drafts=data.appointmentDrafts?.length?data.appointmentDrafts:data.staffService?[{category:data.category,service:data.service,staff:data.staff,staffService:data.staffService,duration:data.staffService?.duration,price:data.staffService?.price}]:[];
  const isMultiDraft=drafts.length>1;
  const [schedulingMode,setSchedulingMode]=useState(data.schedulingMode??"same-day");
  const [selectedIndex,setSelectedIndex]=useState(null);
  const [selectedProposal,setSelectedProposal]=useState(data.selectedScheduleProposal??null);
  const [perDraftDates,setPerDraftDates]=useState(data.perDraftDates??{});
  const [perDraftTimes,setPerDraftTimes]=useState(data.perDraftTimes??{});
  const [singleDate,setSingleDate]=useState(data.date??null);
  const [singleTime,setSingleTime]=useState(data.time??null);
  const [validating,setValidating]=useState(false);

  const handleModeChange=(mode)=>{ setSchedulingMode(mode); setSelectedIndex(null); setSelectedProposal(null); setPerDraftDates({}); setPerDraftTimes({}); updateData({schedulingMode:mode,selectedScheduleProposal:null,sameDayDate:null,date:null,time:null,perDraftDates:{},perDraftTimes:{}}); };
  const handlePerDraftDateSelect=(index,date)=>{ const updatedDates={...perDraftDates,[index]:date}; const updatedTimes={...perDraftTimes}; delete updatedTimes[index]; setPerDraftDates(updatedDates); setPerDraftTimes(updatedTimes); updateData({perDraftDates:updatedDates,perDraftTimes:updatedTimes,selectedScheduleProposal:null});};
  const handlePerDraftTimeSelect=(index,time)=>{ const updatedTimes={...perDraftTimes,[index]:time}; setPerDraftTimes(updatedTimes); updateData({perDraftTimes:updatedTimes});};
  const handleSingleDateSelect=(date)=>{ setSingleDate(date); setSingleTime(null); updateData({date,time:null});};
  const handleSingleTimeSelect=(time)=>{ setSingleTime(time); updateData({time});};
  const handleSingleConfirm=async()=>{ if(!singleDate||!singleTime){ toast.error(t("dateTime.selectDateTime")); return;} const draft=drafts[0]; const staffServiceId=draft?.staffService?.id??data.staffService?.id; setValidating(true); const slotOk=await validateSlotAvailability(staffServiceId,singleDate,singleTime,t); setValidating(false); if(!slotOk){ setSingleTime(null); updateData({time:null}); return;} updateData({date:singleDate,time:singleTime,staffService:draft?.staffService??data.staffService,staff:draft?.staff??data.staff,service:draft?.service??data.service,category:draft?.category??data.category,selectedScheduleProposal:null}); nextStep();};
  const handleSelect=(index,proposal)=>{ setSelectedIndex(index); setSelectedProposal(proposal);};
  const applySameDaySelection=(proposal)=>{ updateData({sameDayDate:new Date(proposal.date),selectedScheduleProposal:proposal,schedulingMode:"same-day"});};
  const allMultiDaySelectionsComplete=drafts.length>0 && drafts.every((_,i)=>perDraftDates[i] && perDraftTimes[i]);

  const handleAutoConfirm=async()=>{ if(!selectedProposal){ toast.error(t("dateTime.selectSlot")); return;} const appointments=selectedProposal.appointments?selectedProposal.appointments.map((a)=>({...a,date:a.date??selectedProposal.date})): [{draftIndex:0,date:selectedProposal.date,time:selectedProposal.time}]; setValidating(true); const allOk=await validateMultiSlotAvailability(drafts,appointments,t); setValidating(false); if(!allOk){ setSelectedIndex(null); setSelectedProposal(null); updateData({selectedScheduleProposal:null,sameDayDate:null}); return;} applySameDaySelection(selectedProposal); nextStep();};
  const handleMultiDayConfirm=async()=>{ if(!allMultiDaySelectionsComplete){ toast.error(t("dateTime.selectEachDateTime")); return;} const appointments=drafts.map((_,i)=>({draftIndex:i,date:perDraftDates[i].toISOString(),time:perDraftTimes[i]})); setValidating(true); const allOk=await validateMultiSlotAvailability(drafts,appointments,t); setValidating(false); if(!allOk) return; updateData({schedulingMode:"multi-day",perDraftDates,perDraftTimes,selectedScheduleProposal:{appointments}}); nextStep();};

  const subtitle=isMultiDraft?`${t("dateTime.appointmentsCount", { count: drafts.length })} • ${drafts.map((d)=>d.staff?.user?.fullName).filter(Boolean).join(", ")}`:`${drafts[0]?.staff?.user?.fullName??data.staff?.user?.fullName??""} • ${drafts[0]?.service?.name??data.service?.name??""}`;

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">{t("dateTime.title")}</h2>
        <p className="mt-2 text-sm text-[#6f6a64]">{subtitle}</p>
        <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
      </div>
      {!isMultiDraft && (<div className="mx-auto max-w-2xl"><SingleDraftView draft={drafts[0]} selectedDate={singleDate} selectedTime={singleTime} onDateSelect={handleSingleDateSelect} onTimeSelect={handleSingleTimeSelect} onConfirm={handleSingleConfirm} validating={validating} /></div>)}
      {isMultiDraft && (<div className="mx-auto max-w-7xl"><div className="grid gap-6 lg:grid-cols-[1fr_300px]"><div className="space-y-6"><div className="rounded-2xl border border-[#ede5d8]/50 bg-white p-5"><p className="mb-4 text-sm font-semibold text-[#2F3A2E]">Comment souhaitez-vous planifier vos rendez-vous ?</p><ModeSwitcher mode={schedulingMode} onChange={handleModeChange} /></div>{schedulingMode==="multi-day"?(<><MultiDayManualView drafts={drafts} perDraftDates={perDraftDates} perDraftTimes={perDraftTimes} onDraftDateSelect={handlePerDraftDateSelect} onDraftTimeSelect={handlePerDraftTimeSelect} />{allMultiDaySelectionsComplete && (<button type="button" onClick={handleMultiDayConfirm} disabled={validating} className={`w-full rounded-full px-6 py-3.5 text-sm font-semibold text-white transition-all ${validating?"cursor-not-allowed bg-[#2F3A2E]/60":"bg-[#2F3A2E] hover:bg-[#212a20]"}`}>{validating?(<span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin"/>Vérification en cours…</span>):"Confirmer les horaires"}</button>)}</>):(<AutoProposalView drafts={drafts} selectedIndex={selectedIndex} onSelect={handleSelect} onConfirm={handleAutoConfirm} validating={validating} />)}</div><div className="lg:sticky lg:top-8 lg:self-start"><DraftSummary drafts={drafts} /></div></div></div>)}
    </div>
  );
}
