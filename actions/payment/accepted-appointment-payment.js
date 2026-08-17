"use server";

import {
  chooseAcceptedPayment,
  getAcceptedPaymentDetails,
} from "@/lib/appointments/accepted-payment";

export async function getAcceptedAppointmentPaymentDetails(appointmentId) {
  return getAcceptedPaymentDetails(appointmentId);
}

export async function chooseAcceptedAppointmentPayment(appointmentId, choice) {
  return chooseAcceptedPayment(appointmentId, choice);
}
