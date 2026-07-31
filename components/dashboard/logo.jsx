import Image from "next/image";

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center justify-center w-[60px] h-[60px] bg-[#2f3a2e] rounded-full ">
            {/* <div className="flex items-center justify-center w-[85px] h-[85px] bg-[#2f3a2e] rounded-full"> */}
               <Image
                className="rounded-full "
                src="/Images/Logo.webp"
                alt="Logo"
                width={50}
                height={50}
              />
            {/* </div> */}
            
          </div>

      {/* <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
        MB
      </span>*/}
      <span className="text-lg font-bold text-dark dark:text-white">
        Meri Beauty
      </span>
    </div>
  );
}
