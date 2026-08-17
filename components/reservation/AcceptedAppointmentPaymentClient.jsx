"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { chooseAcceptedAppointmentPayment } from "@/actions/payment/accepted-appointment-payment";

const LOCALE_MAP = { fr: "fr-BE", en: "en-BE", nl: "nl-BE" };

export default function AcceptedAppointmentPaymentClient({ appointment }) {
  const t = useTranslations("acceptedAppointmentPayment");
  const locale = useLocale();
  const intlLocale = LOCALE_MAP[locale] ?? "fr-BE";
  const [loadingChoice, setLoadingChoice] = useState(null);
  const [confirmed, setConfirmed] = useState(appointment.status === "CONFIRMED");

  const money = (amount) => new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency: "EUR",
  }).format(amount);

  const date = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "long",
    timeZone: "Europe/Brussels",
  }).format(new Date(appointment.date));
  const time = new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  }).format(new Date(appointment.startTime));

  async function choose(choice) {
    setLoadingChoice(choice);
    try {
      const result = await chooseAcceptedAppointmentPayment(appointment.id, choice);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      if (result.confirmed) {
        setConfirmed(true);
        toast.success(result.message);
      }
    } catch {
      toast.error(t("genericError"));
    } finally {
      setLoadingChoice(null);
    }
  }

  if (confirmed) {
    return (
      <section className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8">
          <h1 className="text-3xl font-semibold text-[#2F3A2E]">{t("confirmedTitle")}</h1>
          <p className="mt-3 text-emerald-800">{t("confirmedDescription")}</p>
          <Link href="/mes-reservations" className="mt-7 inline-flex rounded-xl bg-[#2F3A2E] px-6 py-3 font-semibold text-white">
            {t("viewAppointments")}
          </Link>
        </div>
      </section>
    );
  }

  if (appointment.status !== "ACCEPTED") {
    return (
      <section className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-3xl font-semibold text-[#2F3A2E]">{t("unavailableTitle")}</h1>
        <p className="mt-4 text-gray-600">{t("unavailableDescription")}</p>
        <Link href="/mes-reservations" className="mt-7 inline-flex rounded-xl bg-[#2F3A2E] px-6 py-3 font-semibold text-white">
          {t("viewAppointments")}
        </Link>
      </section>
    );
  }

  const options = {
    FULL_ONLINE: {
      title: t("fullOnlineTitle"),
      description: t("fullOnlineDescription", { amount: money(appointment.totalAmount) }),
    },
    DEPOSIT_ONLINE: {
      title: t("depositTitle", { percentage: appointment.depositPercentage }),
      description: t("depositDescription", {
        deposit: money(appointment.depositAmount),
        balance: money(appointment.totalAmount - appointment.depositAmount),
      }),
    },
    ON_SITE: {
      title: t("onSiteTitle"),
      description: t("onSiteDescription", { amount: money(appointment.totalAmount) }),
    },
  };

  return (
    <section className="mx-auto max-w-2xl px-4 py-16">
      <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
        <div className="bg-[#2F3A2E] px-7 py-8 text-white">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#C8A46A]">{t("acceptedBadge")}</p>
          <h1 className="mt-2 text-3xl font-semibold">{t("title")}</h1>
          <p className="mt-2 text-sm text-white/75">{t("subtitle")}</p>
        </div>

        <div className="space-y-6 p-7">
          <dl className="grid gap-4 rounded-2xl bg-gray-50 p-5 sm:grid-cols-2">
            <div><dt className="text-xs uppercase text-gray-500">{t("service")}</dt><dd className="mt-1 font-semibold">{appointment.serviceName}</dd></div>
            <div><dt className="text-xs uppercase text-gray-500">{t("staff")}</dt><dd className="mt-1 font-semibold">{appointment.staffName}</dd></div>
            <div><dt className="text-xs uppercase text-gray-500">{t("date")}</dt><dd className="mt-1 font-semibold">{date}</dd></div>
            <div><dt className="text-xs uppercase text-gray-500">{t("time")}</dt><dd className="mt-1 font-semibold">{time}</dd></div>
          </dl>

          <div>
            <h2 className="text-xl font-semibold text-[#2F3A2E]">{t("chooseTitle")}</h2>
            <div className="mt-4 space-y-3">
              {appointment.choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => choose(choice)}
                  disabled={loadingChoice !== null}
                  className="w-full rounded-2xl border-2 border-gray-200 p-5 text-left transition hover:border-[#C8A46A] hover:bg-[#C8A46A]/5 disabled:opacity-60"
                >
                  <span className="flex items-center justify-between gap-4">
                    <span>
                      <span className="block font-semibold text-[#2F3A2E]">{options[choice].title}</span>
                      <span className="mt-1 block text-sm text-gray-600">{options[choice].description}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-[#C8A46A]">
                      {loadingChoice === choice ? t("processing") : t("choose")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-center text-xs text-gray-500">{t("secureNotice")}</p>
        </div>
      </div>
    </section>
  );
}
