"use client";

import { logoutUser } from "@/actions/auth/logout";
import { ChevronUpIcon } from "@/assets/icons";
import {
  Dropdown,
  DropdownContent,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { LogOutIcon, SettingsIcon, UserIcon } from "./icons";

export function UserInfo({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName = user.name || user.email?.split("@")[0] || "User";

  async function handleLogout() {
    setIsOpen(false);
    await logoutUser();
    window.location.href = "/";
  }

  return (
    <Dropdown isOpen={isOpen} setIsOpen={setIsOpen}>
      <DropdownTrigger className="cursor-pointer rounded align-middle ring-primary ring-offset-2 outline-none focus-visible:ring-1 dark:ring-offset-gray-dark">
        <span className="sr-only">My Account</span>

        <figure className="flex items-center gap-3">
          {user.image ? (
            <Image
              src={user.image}
              className="size-12 overflow-hidden rounded-full object-cover"
              alt={`Avatar of ${displayName}`}
              role="presentation"
              width={200}
              height={200}
            />
          ) : (
            <UserAvatar />
          )}
          <figcaption className="flex items-center gap-1 font-medium text-dark max-[1024px]:sr-only dark:text-dark-6">
            <span className="max-w-24 truncate">{displayName}</span>

            <ChevronUpIcon
              aria-hidden
              className={cn(
                "rotate-180 transition-transform",
                isOpen && "rotate-0",
              )}
              strokeWidth={1.5}
            />
          </figcaption>
        </figure>
      </DropdownTrigger>

      <DropdownContent
        className="border border-stroke bg-white shadow-md min-[230px]:min-w-70 dark:border-dark-3 dark:bg-gray-dark"
        align="end"
      >
        <h2 className="sr-only">User information</h2>

        <figure className="flex items-center gap-2.5 px-5 py-3.5">
          {user.image ? (
            <Image
              src={user.image}
              className="size-12 shrink-0 overflow-hidden rounded-full object-cover object-center"
              alt={`Avatar of ${displayName}`}
              role="presentation"
              width={48}
              height={48}
            />
          ) : (
            <UserAvatar />
          )}

          <figcaption className="space-y-1 text-base font-medium">
            <div className="mb-2 leading-none text-dark dark:text-white">
              {displayName}
            </div>

            <div className="w-full max-w-47.5 truncate leading-none text-gray-6">
              {user.email}
            </div>
            {user.role ? (
              <div className="text-body-xs uppercase text-gray-6">{user.role}</div>
            ) : null}
          </figcaption>
        </figure>

        <hr className="border-[#E8E8E8] dark:border-dark-3" />

        <div className="p-2 text-base text-[#4B5563] *:cursor-pointer dark:text-dark-6">

          <Link
            href={user.role === "STAFF" ? "/dashboard/account-settings" : "/dashboard/settings"}
            onClick={() => setIsOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.25 ring-primary outline-0 hover:bg-gray-2 hover:text-dark focus-visible:ring-1 dark:hover:bg-dark-3 dark:hover:text-white"
          >
            <SettingsIcon />

            <span className="mr-auto text-base font-medium">
              Account Settings
            </span>
          </Link>
        </div>

        <hr className="border-[#E8E8E8] dark:border-dark-3" />

        <div className="p-2 text-base text-[#4B5563] dark:text-dark-6">
          <button
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.25 ring-primary outline-0 hover:bg-gray-2 hover:text-dark focus-visible:ring-1 dark:hover:bg-dark-3 dark:hover:text-white"
            onClick={handleLogout}
          >
            <LogOutIcon />

            <span className="text-base font-medium">Log out</span>
          </button>
        </div>
      </DropdownContent>
    </Dropdown>
  );
}

function UserAvatar() {
  return (
    <span className="flex size-12 items-center justify-center rounded-full border bg-gray-2 text-dark outline-none dark:border-dark-4 dark:bg-dark-2 dark:text-white">
      <UserIcon />
    </span>
  );
}
