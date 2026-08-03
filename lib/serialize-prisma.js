/**
 * Utility functions for serializing Prisma data for Next.js Server-to-Client communication.
 * Prisma Decimal objects cannot be serialized and must be converted to numbers.
 */

/**
 * Serializes a StaffService object by converting Decimal fields to numbers.
 * @param {object} staffService - The StaffService object from Prisma
 * @returns {object} Serialized StaffService with numbers instead of Decimals
 */
export function serializeStaffService(staffService) {
  if (!staffService) return null;
  
  return {
    id: staffService.id,
    staffId: staffService.staffId,
    serviceId: staffService.serviceId,
    createdById: staffService.createdById,
    price: staffService.price !== undefined && staffService.price !== null 
      ? Number(staffService.price) 
      : 0,
    duration: staffService.duration,
    margin: staffService.margin !== undefined && staffService.margin !== null 
      ? Number(staffService.margin) 
      : null,
    photo: staffService.photo ?? "",
    isActive: staffService.isActive,
    createdAt: staffService.createdAt,
    updatedAt: staffService.updatedAt,
    // Include nested relations if they exist
    ...(staffService.staff && { 
      staff: {
        id: staffService.staff.id,
        ...(staffService.staff.user && {
          user: {
            id: staffService.staff.user.id,
            fullName: staffService.staff.user.fullName,
            email: staffService.staff.user.email,
          }
        })
      }
    }),
  };
}

/**
 * Serializes a Payment object by converting Decimal fields to numbers.
 * @param {object} payment - The Payment object from Prisma
 * @returns {object} Serialized Payment with numbers instead of Decimals
 */
export function serializePayment(payment) {
  if (!payment) return null;
  
  return {
    id: payment.id,
    appointmentId: payment.appointmentId,
    depositAmount: payment.depositAmount !== undefined && payment.depositAmount !== null 
      ? Number(payment.depositAmount) 
      : 0,
    totalAmount: payment.totalAmount !== undefined && payment.totalAmount !== null 
      ? Number(payment.totalAmount) 
      : 0,
    paidAmount: payment.paidAmount !== undefined && payment.paidAmount !== null 
      ? Number(payment.paidAmount) 
      : 0,
    remainingAmount: payment.remainingAmount !== undefined && payment.remainingAmount !== null 
      ? Number(payment.remainingAmount) 
      : 0,
    paymentType: payment.paymentType,
    status: payment.status,
    paidAt: payment.paidAt,
    isDeleted: payment.isDeleted,
    deletedAt: payment.deletedAt,
    transactionReference: payment.transactionReference,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/**
 * Serializes a Transaction object by converting Decimal fields to numbers.
 * @param {object} transaction - The Transaction object from Prisma
 * @returns {object} Serialized Transaction with numbers instead of Decimals
 */
export function serializeTransaction(transaction) {
  if (!transaction) return null;
  
  return {
    id: transaction.id,
    paymentId: transaction.paymentId,
    amount: transaction.amount !== undefined && transaction.amount !== null 
      ? Number(transaction.amount) 
      : 0,
    method: transaction.method,
    transactionType: transaction.transactionType,
    paidAt: transaction.paidAt,
    isDeleted: transaction.isDeleted,
    deletedAt: transaction.deletedAt,
    createdAt: transaction.createdAt,
  };
}

/**
 * Serializes a Contract object by converting Decimal fields to numbers.
 * @param {object} contract - The Contract object from Prisma
 * @returns {object} Serialized Contract with numbers instead of Decimals
 */
export function serializeContract(contract) {
  if (!contract) return null;
  
  return {
    id: contract.id,
    staffId: contract.staffId,
    type: contract.type,
    commissionPercentage: contract.commissionPercentage,
    fixedRent: contract.fixedRent !== undefined && contract.fixedRent !== null 
      ? Number(contract.fixedRent) 
      : null,
    startDate: contract.startDate,
    endDate: contract.endDate,
    status: contract.status,
    notes: contract.notes,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  };
}

/**
 * Generic function to serialize any object with Decimal fields.
 * Converts all Decimal fields to numbers.
 * @param {object} obj - The object to serialize
 * @returns {object} Serialized object with numbers instead of Decimals
 */
export function serializeDecimalFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  // Preserve Date objects as-is
  if (obj instanceof Date) return obj;

  // Spreading an array with {...obj} silently turns it into a plain object
  // ({0: ..., 1: ...}, no .map/.slice) — handle top-level arrays explicitly
  // so callers can pass a Prisma findMany() result straight through.
  if (Array.isArray(obj)) {
    return obj.map((item) => serializeDecimalFields(item));
  }

  const result = { ...obj };

  // Check if the object has a toNumber method (Prisma Decimal)
  if (obj.toNumber && typeof obj.toNumber === 'function') {
    return obj.toNumber();
  }
  
  // Recursively serialize nested objects and arrays
  for (const key in result) {
    if (result[key] && typeof result[key] === 'object') {
      if (result[key] instanceof Date) {
        // Keep Date as-is
        continue;
      } else if (result[key].toNumber && typeof result[key].toNumber === 'function') {
        // Convert Decimal to number
        result[key] = result[key].toNumber();
      } else if (Array.isArray(result[key])) {
        // Process array items
        result[key] = result[key].map(item => serializeDecimalFields(item));
      } else {
        // Recursively process nested object
        result[key] = serializeDecimalFields(result[key]);
      }
    }
  }
  
  return result;
}